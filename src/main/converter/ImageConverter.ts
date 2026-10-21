import fs from 'fs';
import path from 'path';
import sharp, { Sharp } from 'sharp';
import bmp from 'bmp-js';
import { DatabaseService } from '../database/DatabaseService';
import { FolderPermissionRegistry } from '../security/FolderPermissionRegistry';

export type SupportedImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff';

export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_BMP_FILE_SIZE = 30 * 1024 * 1024; // 30MB
export const MAX_IMAGE_DIMENSION = 16384; // 16k pixels max width or height
export const MAX_IMAGE_PIXELS = 40_000_000; // 40 Megapixels
export const MAX_FINALIZE_COLLISION_ATTEMPTS = 50;
export const MAX_CONCURRENT_CONVERSIONS = 2;

export interface ImageConversionOptions {
  quality?: number; // 1-100, default 85 for JPEG/WebP/TIFF
  backgroundColor?: string; // hex or color for JPEG alpha flattening, default '#ffffff'
  outputDirectory?: string; // custom output folder (must be approved & pre-existing)
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

  // WebP: RIFF .... WEBP
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

  // BMP: 42 4D ("BM")
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
  private permissionRegistry?: FolderPermissionRegistry;

  private activeConversions = 0;
  private waitQueue: Array<() => void> = [];

  constructor(
    databaseService: DatabaseService,
    permissionRegistry?: FolderPermissionRegistry
  ) {
    this.databaseService = databaseService;
    this.permissionRegistry = permissionRegistry;
  }

  /**
   * Concurrency slot acquisition (limits simultaneous heavy image decoding)
   */
  private async acquireSlot(): Promise<void> {
    if (this.activeConversions < MAX_CONCURRENT_CONVERSIONS) {
      this.activeConversions++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeConversions++;
        resolve();
      });
    });
  }

  /**
   * Concurrency slot release
   */
  private releaseSlot(): void {
    this.activeConversions--;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
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
   * Validates and reads image metadata using magic bytes and sharp/bmp-js,
   * enforcing strict resource and dimensional safety limits.
   */
  public async getImageMetadata(sourcePath: string): Promise<ImageMetadataResult> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`FILE_NOT_FOUND: Source image does not exist: ${sourcePath}`);
    }

    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error(`NOT_A_FILE: Path is not a regular file: ${sourcePath}`);
    }

    // Resource Limit: Check maximum source file size
    if (stat.size > MAX_SOURCE_FILE_BYTES) {
      throw new Error(
        `FILE_TOO_LARGE: Source file size (${stat.size} bytes) exceeds safety limit of ${MAX_SOURCE_FILE_BYTES} bytes (50MB).`
      );
    }

    // Read first 64 bytes to verify magic bytes and extract initial dimensional data
    const fd = await fs.promises.open(sourcePath, 'r');
    const headerBuf = Buffer.alloc(64);
    await fd.read(headerBuf, 0, 64, 0);
    await fd.close();

    const detected = detectImageFormatFromBuffer(headerBuf);
    if (!detected) {
      throw new Error(`UNSUPPORTED_FORMAT: File does not match supported image magic bytes (PNG, JPEG, WebP, BMP, TIFF)`);
    }

    if (detected === 'bmp') {
      if (stat.size > MAX_BMP_FILE_SIZE) {
        throw new Error(
          `FILE_TOO_LARGE: BMP file size (${stat.size} bytes) exceeds BMP memory safety limit of ${MAX_BMP_FILE_SIZE} bytes (30MB).`
        );
      }

      // Read dimensions from BMP header (offset 18 width, offset 22 height) before full decode
      if (headerBuf.length >= 26) {
        const bmpWidth = headerBuf.readInt32LE(18);
        const bmpHeight = Math.abs(headerBuf.readInt32LE(22));
        const bmpPixels = bmpWidth * bmpHeight;

        if (bmpWidth > MAX_IMAGE_DIMENSION || bmpHeight > MAX_IMAGE_DIMENSION || bmpPixels > MAX_IMAGE_PIXELS) {
          throw new Error(
            `IMAGE_TOO_LARGE: BMP image dimensions (${bmpWidth}x${bmpHeight}, ${bmpPixels} pixels) exceed safety limits.`
          );
        }
      }

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

    // Read metadata via sharp with pixel input limit configured
    const meta = await sharp(sourcePath, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const totalPixels = width * height;

    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || totalPixels > MAX_IMAGE_PIXELS) {
      throw new Error(
        `IMAGE_TOO_LARGE: Image dimensions (${width}x${height}, ${totalPixels} pixels) exceed maximum allowed limit of ${MAX_IMAGE_PIXELS} pixels.`
      );
    }

    return {
      width,
      height,
      format: detected,
      sizeBytes: stat.size,
      hasAlpha: Boolean(meta.hasAlpha),
      orientation: meta.orientation
    };
  }

  /**
   * Validates and resolves output directory securely.
   * - Canonicalizes path and prevents null-byte or directory traversal attacks.
   * - Prohibits creating arbitrary directories based on renderer input.
   * - Enforces pre-existing directory presence and write permissions.
   * - Enforces FolderPermissionRegistry if configured.
   * - Defaults safely to source directory.
   */
  public async validateAndResolveOutputDirectory(
    sourcePath: string,
    requestedOutputDir?: string
  ): Promise<string> {
    if (requestedOutputDir && typeof requestedOutputDir === 'string' && requestedOutputDir.trim()) {
      const cleanRaw = requestedOutputDir.replace(/\0/g, '').trim();
      const canonicalOutDir = path.resolve(path.normalize(cleanRaw));

      // 1. Output directory must already exist on disk (no arbitrary directory creation)
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(canonicalOutDir);
      } catch {
        throw new Error(`DIRECTORY_NOT_FOUND: Requested output directory does not exist: ${canonicalOutDir}`);
      }

      if (!stat.isDirectory()) {
        throw new Error(`NOT_A_DIRECTORY: Requested output path is not a directory: ${canonicalOutDir}`);
      }

      // 2. System path boundary checks — use canonical form for containment to avoid
      //    Windows 8.3 short-name vs long-name mismatches between sync/async realpath
      if (this.permissionRegistry) {
        const sysCheck = this.permissionRegistry.isSystemOrRootPath(canonicalOutDir);
        if (sysCheck.isForbidden) {
          throw new Error(`SECURITY_VIOLATION: ${sysCheck.reason}`);
        }

        const authCheck = this.permissionRegistry.isPathWithinApprovedFolder(canonicalOutDir);
        if (!authCheck.isValid) {
          throw new Error(`SECURITY_VIOLATION: Output directory is not within approved folders: ${canonicalOutDir}`);
        }
      }

      // 3. Ensure destination directory is writable
      try {
        await fs.promises.access(canonicalOutDir, fs.constants.W_OK);
      } catch {
        throw new Error(`TARGET_DIR_NOT_WRITABLE: Output directory is read-only or not writable: ${canonicalOutDir}`);
      }

      return canonicalOutDir;
    }

    // Default to source file's directory
    const sourceDir = path.dirname(path.resolve(sourcePath));

    // Verify source directory exists
    try {
      const stat = await fs.promises.stat(sourceDir);
      if (!stat.isDirectory()) {
        throw new Error(`NOT_A_DIRECTORY: Source parent is not a directory: ${sourceDir}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('NOT_A_DIRECTORY')) throw err;
      throw new Error(`DIRECTORY_NOT_FOUND: Cannot access source directory: ${sourceDir}`);
    }

    if (this.permissionRegistry) {
      const sysCheck = this.permissionRegistry.isSystemOrRootPath(sourceDir);
      if (sysCheck.isForbidden) {
        throw new Error(`SECURITY_VIOLATION: Source directory is a protected system location: ${sourceDir}`);
      }

      const authCheck = this.permissionRegistry.isPathWithinApprovedFolder(sourceDir);
      if (!authCheck.isValid) {
        throw new Error(`SECURITY_VIOLATION: Source directory is not within approved folders: ${sourceDir}`);
      }
    }

    try {
      await fs.promises.access(sourceDir, fs.constants.W_OK);
    } catch {
      throw new Error(`TARGET_DIR_NOT_WRITABLE: Source directory is read-only or not writable: ${sourceDir}`);
    }

    return sourceDir;
  }

  /**
   * Checks whether two paths refer to the exact same file (Windows case-insensitive canonical check).
   */
  private isSamePath(p1: string, p2: string): boolean {
    const n1 = path.resolve(p1).toLowerCase();
    const n2 = path.resolve(p2).toLowerCase();
    return n1 === n2;
  }

  /**
   * Finalizes output atomically using hard link (fs.promises.link) publication.
   *
   * Rationale & Guarantees:
   * 1. Hard link (`fs.promises.link`) creates a directory entry pointing to the fully-rendered,
   *    closed temporary file. At the OS kernel level (NTFS on Windows, ext4/APFS on POSIX),
   *    this directory entry creation is atomic. The destination file is NEVER visible to users
   *    or other processes in a partial, half-written, or truncated state.
   * 2. If candidatePath already exists (even as a broken symlink/junction), `link()` fails immediately
   *    with EEXIST without modifying or truncating the pre-existing destination.
   * 3. Because tempPath is created in destDir (the exact same folder/volume as candidatePath),
   *    both paths reside on the same filesystem, fulfilling the same-volume hard-link requirement.
   * 4. Once `link()` succeeds, `tempPath` is unlinked, leaving `candidatePath` as the sole link.
   * 5. If `link()` encounters filesystems that do not support hard links (e.g. EXDEV, ENOTSUP,
   *    or EPERM on FAT32/exFAT), we use a safe fallback with `fs.promises.copyFile(tempPath, candidatePath, COPYFILE_EXCL)`.
   *    If copyFile fails or is interrupted midway (non-EEXIST), any partial candidatePath is
   *    immediately unlinked to prevent partial artifacts from remaining on disk.
   * 6. Source file immutability: isSamePath(candidatePath, sourcePath) strictly prevents
   *    linking or publishing onto the source file.
   * 7. Process collision safety: When EEXIST occurs, the candidate is NOT deleted or touched;
   *    instead, the algorithm deterministically advances to candidate (1), (2), etc.
   */
  public async finalizeOutputFile(
    tempPath: string,
    destDir: string,
    baseName: string,
    normalizedExt: string,
    sourcePath: string
  ): Promise<string> {
    // Ensure temp file exists and has content before publication
    const tempStat = await fs.promises.stat(tempPath);
    if (!tempStat.isFile() || tempStat.size === 0) {
      throw new Error('INVALID_TEMP_FILE: Temporary converted file is missing or 0 bytes.');
    }

    for (let attempt = 0; attempt < MAX_FINALIZE_COLLISION_ATTEMPTS; attempt++) {
      const candidateName =
        attempt === 0
          ? `${baseName}${normalizedExt}`
          : `${baseName} (${attempt})${normalizedExt}`;

      const candidatePath = path.join(destDir, candidateName);

      // Never finalize into the source file itself
      if (this.isSamePath(candidatePath, sourcePath)) {
        continue;
      }

      // Primary strategy: Atomic Hard Link publication
      let hardLinkSupported = true;
      try {
        await fs.promises.link(tempPath, candidatePath);

        // Success! Atomic publication completed.
        // Clean up the temporary link.
        try {
          await fs.promises.unlink(tempPath);
        } catch (unlinkErr) {
          console.warn('[ImageConverter] Warning: could not unlink temp file after successful link:', unlinkErr);
        }

        return candidatePath;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error && error.code === 'EEXIST') {
          // File exists at destination: collision detected. Try next counter name.
          continue;
        }

        // Check if filesystem does not support hard links (FAT32, exFAT, network shares, EXDEV, ENOTSUP, EPERM)
        if (error && (error.code === 'EXDEV' || error.code === 'ENOTSUP' || error.code === 'EPERM' || error.code === 'ENOSYS')) {
          hardLinkSupported = false;
        } else {
          // Any other error (e.g. EACCES on directory): fail safely
          throw err;
        }
      }

      // Fallback strategy for filesystems without hard link support (FAT32/exFAT):
      // Use COPYFILE_EXCL + cleanup on failure
      if (!hardLinkSupported) {
        try {
          await fs.promises.copyFile(tempPath, candidatePath, fs.constants.COPYFILE_EXCL);

          // Clean up temp file
          try {
            await fs.promises.unlink(tempPath);
          } catch {
            // Ignore temp unlink failure
          }

          return candidatePath;
        } catch (copyErr: unknown) {
          const cError = copyErr as NodeJS.ErrnoException;
          if (cError && cError.code === 'EEXIST') {
            continue;
          }
          // If copyFile was interrupted or failed non-EEXIST, clean up any partial file that was created
          try {
            if (fs.existsSync(candidatePath)) {
              await fs.promises.unlink(candidatePath);
            }
          } catch {
            // Ignore cleanup error
          }
          throw copyErr;
        }
      }
    }

    throw new Error(
      `NAME_CONFLICT_EXCEEDED: Could not find unique non-existing destination after ${MAX_FINALIZE_COLLISION_ATTEMPTS} attempts.`
    );
  }

  /**
   * Generates a candidate non-colliding destination path (preview/estimation).
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
   * Hardened Features:
   * - Strict input validation & magic-bytes format checking.
   * - Resource limits: 50MB source limit, 40MP image limit, BMP memory limits.
   * - Output directory validation: no arbitrary mkdir, approved scope enforcement, write checks.
   * - Anti-overwrite guarantee: atomic exclusive copy (COPYFILE_EXCL) with limited collision loop.
   * - Concurrency limiter: max 2 simultaneous conversions.
   * - Temporary file cleanup guaranteed in finally block.
   */
  public async convertImage(
    sourcePath: string,
    rawTargetFormat: string,
    options: ImageConversionOptions = {}
  ): Promise<ConversionResult> {
    const startTime = Date.now();
    const jobId = `job-${startTime}-${Math.random().toString(36).slice(2, 7)}`;
    const sourceFilename = path.basename(sourcePath);

    let tempPath: string | null = null;

    // Acquire concurrency slot
    await this.acquireSlot();

    try {
      // Normalize target format
      let targetFormat = rawTargetFormat.trim().toLowerCase();
      if (targetFormat === 'jpg') targetFormat = 'jpeg';

      const validTargets: SupportedImageFormat[] = ['png', 'jpeg', 'webp', 'bmp', 'tiff'];
      if (!validTargets.includes(targetFormat as SupportedImageFormat)) {
        const err = `UNSUPPORTED_TARGET_FORMAT: Target '${rawTargetFormat}' is not supported. Supported: PNG, JPEG, WebP, BMP, TIFF.`;
        this.databaseService.insertConversionJob({
          id: jobId,
          source_path: sourcePath,
          source_filename: sourceFilename,
          input_format: 'unknown',
          output_format: targetFormat,
          status: 'FAILED',
          progress: 0,
          created_at: startTime,
          completed_at: Date.now(),
          duration_ms: Date.now() - startTime,
          error_message: err
        });

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

      // Step 1: Validate source file and enforce resource limits
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
          status: 'FAILED',
          progress: 0,
          created_at: startTime,
          completed_at: Date.now(),
          duration_ms: Date.now() - startTime,
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

      // Step 2: Validate destination directory securely
      let destDir: string;
      try {
        destDir = await this.validateAndResolveOutputDirectory(sourcePath, options.outputDirectory);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.databaseService.insertConversionJob({
          id: jobId,
          source_path: sourcePath,
          source_filename: sourceFilename,
          input_format: metadata.format,
          output_format: targetFormat,
          status: 'FAILED',
          progress: 0,
          created_at: startTime,
          completed_at: Date.now(),
          duration_ms: Date.now() - startTime,
          error_message: msg
        });

        return {
          success: false,
          jobId,
          sourcePath,
          sourceSizeBytes: metadata.sizeBytes,
          inputFormat: metadata.format,
          outputFormat: targetFormat,
          durationMs: Date.now() - startTime,
          error: msg
        };
      }

      // Step 3: Record pending job in database
      this.databaseService.insertConversionJob({
        id: jobId,
        source_path: sourcePath,
        source_filename: sourceFilename,
        input_format: metadata.format,
        output_format: targetFormat,
        status: 'RUNNING',
        progress: 10,
        created_at: startTime,
        started_at: startTime
      });

      // Target extension mapping
      const extensionMap: Record<string, string> = {
        png: '.png',
        jpeg: '.jpg',
        webp: '.webp',
        bmp: '.bmp',
        tiff: '.tiff'
      };
      const targetExt = extensionMap[targetFormat] || `.${targetFormat}`;
      const baseName = options.customFilename && options.customFilename.trim()
        ? path.basename(options.customFilename.trim())
        : path.basename(sourcePath, path.extname(sourcePath));

      // Setup unique temporary file path in the validated destination directory
      tempPath = path.join(
        destDir,
        `.${baseName}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      );

      const quality = Math.max(1, Math.min(100, options.quality ?? 85));
      const bgColor = options.backgroundColor || '#ffffff';

      // Load image into sharp pipeline with pixel limits enforced
      let pipeline: Sharp;

      if (metadata.format === 'bmp') {
        const bmpRaw = await fs.promises.readFile(sourcePath);
        const decoded = bmp.decode(bmpRaw);
        pipeline = sharp(decoded.data, {
          raw: {
            width: decoded.width,
            height: decoded.height,
            channels: 4
          },
          limitInputPixels: MAX_IMAGE_PIXELS
        });
      } else {
        pipeline = sharp(sourcePath, { limitInputPixels: MAX_IMAGE_PIXELS });
      }

      // Auto-orient based on EXIF
      pipeline = pipeline.rotate();

      // Configure output format
      if (targetFormat === 'jpeg') {
        pipeline = pipeline.flatten({ background: bgColor }).jpeg({ quality, mozjpeg: true });
      } else if (targetFormat === 'png') {
        pipeline = pipeline.png({ compressionLevel: 9 });
      } else if (targetFormat === 'webp') {
        pipeline = pipeline.webp({ quality, lossless: false });
      } else if (targetFormat === 'tiff') {
        pipeline = pipeline.tiff({ quality, compression: 'lzw' });
      } else if (targetFormat === 'bmp') {
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

      if (targetFormat !== 'bmp') {
        await pipeline.toFile(tempPath);
      }

      // Verify temp file exists and has valid non-zero content
      const tempStat = await fs.promises.stat(tempPath);
      if (tempStat.size === 0) {
        throw new Error('CORRUPT_OUTPUT: Produced image file has 0 bytes.');
      }

      // Step 4: Finalize output file with kernel-level anti-overwrite guarantee
      const finalizedOutputPath = await this.finalizeOutputFile(
        tempPath,
        destDir,
        baseName,
        targetExt,
        sourcePath
      );
      tempPath = null; // Successfully transferred

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      // Update database
      this.databaseService.updateConversionJob(jobId, {
        status: 'SUCCEEDED',
        progress: 100,
        output_path: finalizedOutputPath,
        completed_at: endTime,
        duration_ms: durationMs
      });

      this.databaseService.logActivity({
        event_type: 'IMAGE_CONVERSION_COMPLETED',
        resource_type: 'FILE',
        resource_id: jobId,
        summary: `Converted ${sourceFilename} (${metadata.format.toUpperCase()}) to ${path.basename(finalizedOutputPath)} (${targetFormat.toUpperCase()}) in ${durationMs}ms`,
        details: {
          sourcePath,
          destinationPath: finalizedOutputPath,
          sourceBytes: metadata.sizeBytes,
          outputBytes: tempStat.size,
          durationMs
        }
      });

      return {
        success: true,
        jobId,
        sourcePath,
        outputPath: finalizedOutputPath,
        sourceSizeBytes: metadata.sizeBytes,
        outputSizeBytes: tempStat.size,
        inputFormat: metadata.format,
        outputFormat: targetFormat,
        durationMs
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const endTime = Date.now();

      this.databaseService.updateConversionJob(jobId, {
        status: 'FAILED',
        completed_at: endTime,
        duration_ms: endTime - startTime,
        error_message: msg
      });

      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes: 0,
        inputFormat: 'unknown',
        outputFormat: rawTargetFormat,
        durationMs: endTime - startTime,
        error: msg
      };
    } finally {
      // Ensure concurrency slot is always released
      this.releaseSlot();

      // Clean up temp file if still present
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // Ignore temp cleanup error
        }
      }
    }
  }
}
