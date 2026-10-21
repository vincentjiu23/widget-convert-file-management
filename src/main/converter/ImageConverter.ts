import fs from 'fs';
import path from 'path';
import sharp, { Sharp } from 'sharp';
import bmp from 'bmp-js';
import { DatabaseService } from '../database/DatabaseService';

export type SupportedImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff';

export interface ImageConversionOptions {
  quality?: number; // 1-100, default 85 for JPEG/WebP/TIFF
  backgroundColor?: string; // hex or color for JPEG alpha flattening, default '#ffffff'
  outputDirectory?: string; // custom output folder
  customFilename?: string; // custom target filename (without ext)
}

export interface ImageMetadataResult {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  hasAlpha: boolean;
  orientation?: number;
}

export interface ConversionResult {
  success: boolean;
  jobId: string;
  sourcePath: string;
  outputPath?: string;
  sourceSizeBytes: number;
  outputSizeBytes?: number;
  inputFormat: string;
  outputFormat: string;
  durationMs: number;
  error?: string;
}

/**
 * Detects image format strictly from binary file signature (magic bytes),
 * never trusting arbitrary file extensions.
 */
export function detectImageFormatFromBuffer(buffer: Buffer): SupportedImageFormat | null {
  if (!buffer || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  // BMP: BM (0x42, 0x4D)
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'bmp';
  }

  // TIFF: II (0x49 0x49 0x2A 0x00) or MM (0x4D 0x4D 0x00 0x2A)
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return 'tiff';
  }

  return null;
}

export class ImageConverter {
  private databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
  }

  /**
   * Detects supported image format from file magic bytes.
   */
  public async detectFormat(sourcePath: string): Promise<SupportedImageFormat> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`FILE_NOT_FOUND: Source image does not exist: ${sourcePath}`);
    }
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error(`NOT_A_FILE: Path is not a regular file: ${sourcePath}`);
    }
    const fd = await fs.promises.open(sourcePath, 'r');
    const headerBuf = Buffer.alloc(64);
    await fd.read(headerBuf, 0, 64, 0);
    await fd.close();

    const detected = detectImageFormatFromBuffer(headerBuf);
    if (!detected) {
      throw new Error(`Unsupported image format or corrupt header: ${sourcePath}`);
    }
    return detected;
  }

  /**
   * Convenience wrapper for convertImage using an object parameter.
   */
  public async convert(params: {
    sourcePath: string;
    targetFormat: string;
    quality?: number;
    backgroundColor?: string;
    outputDirectory?: string;
    customFilename?: string;
  }): Promise<ConversionResult> {
    const { sourcePath, targetFormat, ...options } = params;
    return this.convertImage(sourcePath, targetFormat, options);
  }

  /**
   * Validates and reads image metadata using magic bytes and sharp/bmp-js
   */
  public async getImageMetadata(sourcePath: string): Promise<ImageMetadataResult> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`FILE_NOT_FOUND: Source image does not exist: ${sourcePath}`);
    }

    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error(`NOT_A_FILE: Path is not a regular file: ${sourcePath}`);
    }

    // Read first 64 bytes to verify magic bytes
    const fd = await fs.promises.open(sourcePath, 'r');
    const headerBuf = Buffer.alloc(64);
    await fd.read(headerBuf, 0, 64, 0);
    await fd.close();

    const detected = detectImageFormatFromBuffer(headerBuf);
    if (!detected) {
      throw new Error(`UNSUPPORTED_FORMAT: File does not match supported image magic bytes (PNG, JPEG, WebP, BMP, TIFF)`);
    }

    if (detected === 'bmp') {
      const fullBuffer = await fs.promises.readFile(sourcePath);
      const decoded = bmp.decode(fullBuffer);
      return {
        width: decoded.width,
        height: decoded.height,
        format: 'bmp',
        sizeBytes: stat.size,
        hasAlpha: true
      };
    }

    const meta = await sharp(sourcePath).metadata();
    return {
      width: meta.width || 0,
      height: meta.height || 0,
      format: detected,
      sizeBytes: stat.size,
      hasAlpha: Boolean(meta.hasAlpha),
      orientation: meta.orientation
    };
  }

  /**
   * Generates a safe, non-colliding destination path.
   * Guarantees that:
   * 1. The source file is NEVER overwritten.
   * 2. Any existing file at the destination is preserved by appending ' (1)', ' (2)', etc.
   */
  public generateUniqueDestinationPath(
    sourcePath: string,
    targetExt: string,
    outputDirectory?: string,
    customFilename?: string
  ): string {
    const dir = outputDirectory && outputDirectory.trim()
      ? path.resolve(outputDirectory.trim())
      : path.dirname(sourcePath);

    const baseName = customFilename && customFilename.trim()
      ? customFilename.trim()
      : path.basename(sourcePath, path.extname(sourcePath));

    const normalizedExt = targetExt.startsWith('.') ? targetExt.toLowerCase() : `.${targetExt.toLowerCase()}`;
    const canonicalSource = path.resolve(sourcePath).toLowerCase();

    let candidateName = `${baseName}${normalizedExt}`;
    let candidatePath = path.join(dir, candidateName);
    let counter = 1;

    // Never overwrite source file, and never overwrite existing output silently
    while (
      path.resolve(candidatePath).toLowerCase() === canonicalSource ||
      fs.existsSync(candidatePath)
    ) {
      candidateName = `${baseName} (${counter})${normalizedExt}`;
      candidatePath = path.join(dir, candidateName);
      counter++;
    }

    return candidatePath;
  }

  /**
   * Executes true raster-to-raster image conversion end-to-end.
   * Features:
   * - Strict input validation & magic-bytes format checking.
   * - EXIF orientation auto-rotation.
   * - Safe JPEG background flattening for transparent images.
   * - Atomic file write via temporary file (.tmp) with cleanup on failure.
   * - Persistent logging in conversion_jobs SQLite table.
   */
  public async convertImage(
    sourcePath: string,
    rawTargetFormat: string,
    options: ImageConversionOptions = {}
  ): Promise<ConversionResult> {
    const startTime = Date.now();
    const jobId = `job-${startTime}-${Math.random().toString(36).slice(2, 7)}`;
    const sourceFilename = path.basename(sourcePath);

    // Normalize target format
    let targetFormat = rawTargetFormat.trim().toLowerCase();
    if (targetFormat === 'jpg') targetFormat = 'jpeg';

    const validTargets: SupportedImageFormat[] = ['png', 'jpeg', 'webp', 'bmp', 'tiff'];
    if (!validTargets.includes(targetFormat as SupportedImageFormat)) {
      const err = `UNSUPPORTED_TARGET_FORMAT: Target '${rawTargetFormat}' is not supported. Supported: PNG, JPEG, WebP, BMP, TIFF.`;
      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes: 0,
        inputFormat: 'unknown',
        outputFormat: targetFormat,
        durationMs: Date.now() - startTime,
        error: err
      };
    }

    // Step 1: Validate source file
    let metadata: ImageMetadataResult;
    try {
      metadata = await this.getImageMetadata(sourcePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.databaseService.insertConversionJob({
        id: jobId,
        source_path: sourcePath,
        source_filename: sourceFilename,
        input_format: 'unknown',
        output_format: targetFormat,
        output_path: null,
        status: 'FAILED',
        progress: 0,
        created_at: startTime,
        started_at: startTime,
        completed_at: Date.now(),
        duration_ms: Date.now() - startTime,
        error_code: 'VALIDATION_FAILED',
        error_message: msg
      });

      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes: 0,
        inputFormat: 'unknown',
        outputFormat: targetFormat,
        durationMs: Date.now() - startTime,
        error: msg
      };
    }

    // Step 2: Log job initiation
    this.databaseService.insertConversionJob({
      id: jobId,
      source_path: sourcePath,
      source_filename: sourceFilename,
      input_format: metadata.format,
      output_format: targetFormat,
      output_path: null,
      status: 'RUNNING',
      progress: 25,
      created_at: startTime,
      started_at: startTime,
      completed_at: null,
      duration_ms: null,
      error_code: null,
      error_message: null
    });

    // Step 3: Determine target destination and temp file path
    const extensionMap: Record<string, string> = {
      jpeg: '.jpg',
      png: '.png',
      webp: '.webp',
      bmp: '.bmp',
      tiff: '.tiff'
    };
    const targetExt = extensionMap[targetFormat] || `.${targetFormat}`;
    const destinationPath = this.generateUniqueDestinationPath(
      sourcePath,
      targetExt,
      options.outputDirectory,
      options.customFilename
    );

    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    const tempPath = path.join(
      destDir,
      `.${path.basename(destinationPath)}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );

    try {
      const quality = Math.max(1, Math.min(100, options.quality ?? 85));
      const bgColor = options.backgroundColor || '#ffffff';

      // Load image into sharp pipeline
      let pipeline: Sharp;

      if (metadata.format === 'bmp') {
        // Decode BMP with bmp-js, then feed raw RGBA buffer to sharp
        const bmpRaw = await fs.promises.readFile(sourcePath);
        const decoded = bmp.decode(bmpRaw);
        pipeline = sharp(decoded.data, {
          raw: {
            width: decoded.width,
            height: decoded.height,
            channels: 4
          }
        });
      } else {
        pipeline = sharp(sourcePath);
      }

      // Auto-orient based on EXIF tag and remove EXIF orientation to prevent double rotation
      pipeline = pipeline.rotate();

      // Configure output format
      if (targetFormat === 'jpeg') {
        // JPEG doesn't support alpha transparency: flatten with solid background
        pipeline = pipeline.flatten({ background: bgColor }).jpeg({ quality, mozjpeg: true });
      } else if (targetFormat === 'png') {
        pipeline = pipeline.png({ compressionLevel: 9 });
      } else if (targetFormat === 'webp') {
        pipeline = pipeline.webp({ quality, lossless: false });
      } else if (targetFormat === 'tiff') {
        pipeline = pipeline.tiff({ quality, compression: 'lzw' });
      } else if (targetFormat === 'bmp') {
        // Sharp generates raw RGBA -> bmp-js encodes Windows BMP
        const { data, info } = await pipeline
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const bmpEncoded = bmp.encode({
          data,
          width: info.width,
          height: info.height
        });

        await fs.promises.writeFile(tempPath, bmpEncoded.data);
      }

      // For non-BMP formats, write directly to temp file via sharp pipeline
      if (targetFormat !== 'bmp') {
        await pipeline.toFile(tempPath);
      }

      // Step 4: Verify temp file exists and has valid non-zero content
      const tempStat = await fs.promises.stat(tempPath);
      if (tempStat.size === 0) {
        throw new Error('CORRUPT_OUTPUT: Produced image file has 0 bytes.');
      }

      // Step 5: Atomic rename from temp file to final destination
      await fs.promises.rename(tempPath, destinationPath);

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      // Update database
      this.databaseService.updateConversionJob(jobId, {
        status: 'SUCCEEDED',
        progress: 100,
        output_path: destinationPath,
        completed_at: endTime,
        duration_ms: durationMs
      });

      this.databaseService.logActivity({
        event_type: 'IMAGE_CONVERSION_COMPLETED',
        resource_type: 'FILE',
        resource_id: jobId,
        summary: `Converted ${sourceFilename} (${metadata.format.toUpperCase()}) to ${path.basename(destinationPath)} (${targetFormat.toUpperCase()}) in ${durationMs}ms`,
        details: {
          sourcePath,
          destinationPath,
          sourceBytes: metadata.sizeBytes,
          outputBytes: tempStat.size,
          durationMs
        }
      });

      return {
        success: true,
        jobId,
        sourcePath,
        outputPath: destinationPath,
        sourceSizeBytes: metadata.sizeBytes,
        outputSizeBytes: tempStat.size,
        inputFormat: metadata.format,
        outputFormat: targetFormat,
        durationMs
      };
    } catch (err: unknown) {
      // Cleanup temp file if left behind
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // ignore cleanup error
      }

      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.databaseService.updateConversionJob(jobId, {
        status: 'FAILED',
        progress: 0,
        completed_at: endTime,
        duration_ms: durationMs,
        error_code: 'CONVERSION_EXECUTION_ERROR',
        error_message: errorMsg
      });

      this.databaseService.logActivity({
        event_type: 'IMAGE_CONVERSION_FAILED',
        resource_type: 'FILE',
        resource_id: jobId,
        summary: `Failed to convert ${sourceFilename} to ${targetFormat.toUpperCase()}: ${errorMsg}`,
        details: { sourcePath, error: errorMsg }
      });

      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes: metadata.sizeBytes,
        inputFormat: metadata.format,
        outputFormat: targetFormat,
        durationMs,
        error: errorMsg
      };
    }
  }
}
