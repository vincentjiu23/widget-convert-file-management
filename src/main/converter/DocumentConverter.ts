import fs from 'fs';
import path from 'path';
// @ts-ignore - Import direct lib to avoid index.js debug test evaluation
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { DatabaseService } from '../database/DatabaseService';
import { FolderPermissionRegistry } from '../security/FolderPermissionRegistry';

export const MAX_PDF_SOURCE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_EXTRACTED_TEXT_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_DOC_FINALIZE_COLLISION_ATTEMPTS = 50;

export interface DocumentConversionOptions {
  outputDirectory?: string;
  customFilename?: string;
}

export interface DocumentConversionResult {
  success: boolean;
  jobId: string;
  sourcePath: string;
  outputPath?: string;
  sourceSizeBytes: number;
  outputSizeBytes?: number;
  pageCount?: number;
  inputFormat: string;
  outputFormat: string;
  durationMs: number;
  error?: string;
}

/**
 * Validates PDF binary header magic bytes (%PDF-).
 */
export function isPdfMagicBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 && // F
    buffer[4] === 0x2d    // -
  );
}

export class DocumentConverter {
  private databaseService: DatabaseService;
  private permissionRegistry?: FolderPermissionRegistry;

  constructor(
    databaseService: DatabaseService,
    permissionRegistry?: FolderPermissionRegistry
  ) {
    this.databaseService = databaseService;
    this.permissionRegistry = permissionRegistry;
  }

  private isSamePath(p1: string, p2: string): boolean {
    return path.resolve(p1).toLowerCase() === path.resolve(p2).toLowerCase();
  }

  /**
   * Finalizes output atomically using hard link (fs.promises.link) publication.
   * Guarantees:
   * 1. Hard link (fs.promises.link) creates a directory entry pointing to the fully-rendered,
   *    closed temporary file. This creation is atomic at the OS kernel level.
   *    Destination file is NEVER visible to other processes in a partial, truncated state.
   * 2. If candidatePath already exists, link() fails with EEXIST without touching the existing file.
   * 3. Once link() succeeds, tempPath is unlinked, leaving candidatePath as the published file.
   * 4. Safe fallback for filesystems without hard link support (FAT32/exFAT): fs.promises.copyFile with COPYFILE_EXCL.
   *    If copyFile fails or is interrupted midway, candidatePath is unlinked immediately.
   * 5. Source file immutability: isSamePath(candidatePath, sourcePath) strictly prevents overwrite.
   */
  public async finalizeOutputFile(
    tempPath: string,
    destDir: string,
    baseName: string,
    extensionWithDot: string,
    sourcePath: string
  ): Promise<string> {
    const tempStat = await fs.promises.stat(tempPath);
    if (!tempStat.isFile() || tempStat.size === 0) {
      throw new Error('INVALID_TEMP_FILE: Temporary text file is missing or 0 bytes.');
    }

    for (let attempt = 0; attempt < MAX_DOC_FINALIZE_COLLISION_ATTEMPTS; attempt++) {
      const candidateName =
        attempt === 0
          ? `${baseName}${extensionWithDot}`
          : `${baseName} (${attempt})${extensionWithDot}`;

      const candidatePath = path.join(destDir, candidateName);

      if (this.isSamePath(candidatePath, sourcePath)) {
        continue;
      }

      // Primary strategy: Atomic Hard Link publication
      let hardLinkSupported = true;
      try {
        await fs.promises.link(tempPath, candidatePath);

        // Success! Clean up temporary staging link
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // Ignore temp unlink failure
        }

        return candidatePath;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error && error.code === 'EEXIST') {
          // File exists: collision detected. Try next attempt counter.
          continue;
        }

        if (error && (error.code === 'EXDEV' || error.code === 'ENOTSUP' || error.code === 'EPERM' || error.code === 'ENOSYS')) {
          hardLinkSupported = false;
        } else {
          throw err;
        }
      }

      // Fallback strategy: COPYFILE_EXCL (non-overwriting exclusive copy)
      if (!hardLinkSupported) {
        try {
          await fs.promises.copyFile(tempPath, candidatePath, fs.constants.COPYFILE_EXCL);

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

          // If copyFile was interrupted or failed non-EEXIST, purge any partial file
          try {
            if (fs.existsSync(candidatePath)) {
              await fs.promises.unlink(candidatePath);
            }
          } catch {
            // Ignore cleanup failure
          }
          throw copyErr;
        }
      }
    }

    // Timestamp fallback if MAX_DOC_FINALIZE_COLLISION_ATTEMPTS exceeded
    const fallbackPath = path.join(destDir, `${baseName}-${Date.now()}${extensionWithDot}`);
    await fs.promises.copyFile(tempPath, fallbackPath, fs.constants.COPYFILE_EXCL);
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // ignore
    }
    return fallbackPath;
  }

  /**
   * Converts a supported document (currently PDF to TXT text extraction).
   * Verifies source file within approved folders, enforces resource limits,
   * performs atomic file writing with collision avoidance, and synchronizes SQLite database.
   */
  public async convertDocument(
    sourcePath: string,
    targetFormat: string,
    options?: DocumentConversionOptions
  ): Promise<DocumentConversionResult> {
    const startTime = Date.now();
    const jobId = `job-doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const filename = path.basename(sourcePath);
    const ext = path.extname(sourcePath).toLowerCase().replace(/^\./, '');
    const cleanTarget = targetFormat.toLowerCase().replace(/^\./, '');

    let sourceSizeBytes = 0;

    // 1. Initial job registration in database (status: QUEUED)
    this.databaseService.insertConversionJob({
      id: jobId,
      source_path: sourcePath,
      source_filename: filename,
      input_format: ext,
      output_format: cleanTarget,
      output_path: null,
      status: 'QUEUED',
      progress: 0,
      created_at: startTime
    });

    // 2. Validate format support
    if (ext !== 'pdf' || cleanTarget !== 'txt') {
      const err = `UNSUPPORTED_TARGET_FORMAT: Document converter currently supports PDF to TXT text extraction. Got .${ext} to .${cleanTarget}`;
      this.databaseService.updateConversionJob(jobId, {
        status: 'UNSUPPORTED',
        completed_at: Date.now(),
        duration_ms: Date.now() - startTime,
        error_code: 'UNSUPPORTED_DOCUMENT_FORMAT',
        error_message: err
      });
      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes: 0,
        inputFormat: ext,
        outputFormat: cleanTarget,
        durationMs: Date.now() - startTime,
        error: err
      };
    }

    // 3. Resolve and validate canonical source path
    let canonicalSource: string;
    try {
      canonicalSource = await fs.promises.realpath(sourcePath);
      const stat = await fs.promises.stat(canonicalSource);
      if (!stat.isFile()) {
        throw new Error('Source is not a standard file');
      }
      sourceSizeBytes = stat.size;
    } catch (err: unknown) {
      const errMsg = `FILE_ACCESS_ERROR: Cannot access source file: ${err instanceof Error ? err.message : String(err)}`;
      this.databaseService.updateConversionJob(jobId, {
        status: 'FAILED',
        completed_at: Date.now(),
        duration_ms: Date.now() - startTime,
        error_code: 'SOURCE_ACCESS_FAILED',
        error_message: errMsg
      });
      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes: 0,
        inputFormat: ext,
        outputFormat: cleanTarget,
        durationMs: Date.now() - startTime,
        error: errMsg
      };
    }

    // 4. Permission boundary check
    if (this.permissionRegistry) {
      const check = this.permissionRegistry.isPathWithinApprovedFolder(canonicalSource);
      if (!check.isValid) {
        const errMsg = 'SECURITY_VIOLATION: Source document is outside approved user folders';
        this.databaseService.updateConversionJob(jobId, {
          status: 'FAILED',
          completed_at: Date.now(),
          duration_ms: Date.now() - startTime,
          error_code: 'SECURITY_VIOLATION',
          error_message: errMsg
        });
        return {
          success: false,
          jobId,
          sourcePath,
          sourceSizeBytes,
          inputFormat: ext,
          outputFormat: cleanTarget,
          durationMs: Date.now() - startTime,
          error: errMsg
        };
      }
    }

    // 5. Enforce source size limit (50MB)
    if (sourceSizeBytes > MAX_PDF_SOURCE_BYTES) {
      const errMsg = `RESOURCE_LIMIT_EXCEEDED: PDF file exceeds maximum size limit of 50MB (actual: ${(sourceSizeBytes / (1024 * 1024)).toFixed(1)}MB)`;
      this.databaseService.updateConversionJob(jobId, {
        status: 'FAILED',
        completed_at: Date.now(),
        duration_ms: Date.now() - startTime,
        error_code: 'SIZE_LIMIT_EXCEEDED',
        error_message: errMsg
      });
      return {
        success: false,
        jobId,
        sourcePath,
        sourceSizeBytes,
        inputFormat: ext,
        outputFormat: cleanTarget,
        durationMs: Date.now() - startTime,
        error: errMsg
      };
    }

    // 6. Transition to PROCESSING state in DB
    this.databaseService.updateConversionJob(jobId, {
      status: 'RUNNING',
      started_at: Date.now(),
      progress: 25
    });

    let tempOutputPath: string | null = null;

    try {
      // 7. Read source buffer & verify PDF magic bytes
      const pdfBuffer = await fs.promises.readFile(canonicalSource);
      if (!isPdfMagicBytes(pdfBuffer)) {
        throw new Error('INVALID_PDF_CONTENT: File header does not contain valid PDF magic bytes (%PDF-)');
      }

      // 8. Extract text via pdf-parse
      let pdfData: { text?: string; numpages?: number; info?: Record<string, unknown> };
      try {
        pdfData = await pdfParse(pdfBuffer);
      } catch (parseErr: unknown) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        if (parseMsg.toLowerCase().includes('password') || parseMsg.toLowerCase().includes('encrypt')) {
          throw new Error('PDF_ENCRYPTED: Document is password protected or encrypted. Decrypt before converting.');
        }
        throw new Error(`EXTRACTION_FAILED: Corrupted or unreadable PDF structure: ${parseMsg}`);
      }

      const rawText = pdfData.text || '';
      const trimmedText = rawText.trim();

      // Check for scanned / raster-only PDF requiring OCR
      if (!trimmedText) {
        throw new Error(
          'NO_TEXT_FOUND: No extractable text found in PDF. Scanned or raster-only PDFs require OCR, which is not yet supported.'
        );
      }

      // 9. Enforce extracted text limit
      const textBuffer = Buffer.from(rawText, 'utf-8');
      if (textBuffer.length > MAX_EXTRACTED_TEXT_BYTES) {
        throw new Error(`RESOURCE_LIMIT_EXCEEDED: Extracted text exceeds 20MB limit`);
      }

      // 10. Determine target directory
      let targetDir = path.dirname(canonicalSource);
      if (options?.outputDirectory && options.outputDirectory.trim()) {
        const customDir = options.outputDirectory.trim();
        if (this.permissionRegistry) {
          const outCheck = this.permissionRegistry.isPathWithinApprovedFolder(customDir);
          if (!outCheck.isValid) {
            throw new Error('SECURITY_VIOLATION: Output directory is not within approved folders');
          }
          targetDir = outCheck.canonicalPath;
        } else {
          targetDir = await fs.promises.realpath(customDir);
        }
      }

      // 11. Write to temporary staging file in target directory first (atomic pattern)
      const parsed = path.parse(canonicalSource);
      const baseName = options?.customFilename ? path.parse(options.customFilename).name : parsed.name;
      const stagingFilename = `.tmp_${jobId}_${baseName}.txt`;
      tempOutputPath = path.join(targetDir, stagingFilename);

      await fs.promises.writeFile(tempOutputPath, textBuffer);

      // Verify temp staging file exists and has content
      const tempStat = await fs.promises.stat(tempOutputPath);
      if (tempStat.size === 0) {
        throw new Error('EXTRACTION_INTEGRITY_ERROR: Staged text file is 0 bytes');
      }

      // 12. Finalize unique destination file path with atomic hard-link publication
      const finalDestPath = await this.finalizeOutputFile(
        tempOutputPath,
        targetDir,
        baseName,
        '.txt',
        canonicalSource
      );
      tempOutputPath = null;

      // 13. Verify final output file on disk
      const finalStat = await fs.promises.stat(finalDestPath);
      const durationMs = Date.now() - startTime;

      // 14. Synchronize database: mark SUCCEEDED with verified output_path
      this.databaseService.updateConversionJob(jobId, {
        output_path: finalDestPath,
        status: 'SUCCEEDED',
        progress: 100,
        completed_at: Date.now(),
        duration_ms: durationMs,
        error_message: null
      });

      this.databaseService.logActivity({
        event_type: 'DOCUMENT_CONVERTED',
        resource_type: 'CONVERSION_JOB',
        resource_id: jobId,
        summary: `Extracted text from ${filename} -> ${path.basename(finalDestPath)} (${pdfData.numpages || 1} pages, ${finalStat.size} bytes)`,
        details: {
          sourcePath: canonicalSource,
          outputPath: finalDestPath,
          pageCount: pdfData.numpages,
          durationMs
        }
      });

      return {
        success: true,
        jobId,
        sourcePath: canonicalSource,
        outputPath: finalDestPath,
        sourceSizeBytes,
        outputSizeBytes: finalStat.size,
        pageCount: pdfData.numpages,
        inputFormat: ext,
        outputFormat: 'txt',
        durationMs
      };
    } catch (err: unknown) {
      // Clean up temp staging file if still present
      if (tempOutputPath && fs.existsSync(tempOutputPath)) {
        try {
          await fs.promises.unlink(tempOutputPath);
        } catch {
          // ignore cleanup error
        }
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;

      this.databaseService.updateConversionJob(jobId, {
        status: 'FAILED',
        progress: 0,
        completed_at: Date.now(),
        duration_ms: durationMs,
        error_code: 'CONVERSION_FAILED',
        error_message: errMsg
      });

      this.databaseService.logActivity({
        event_type: 'DOCUMENT_CONVERSION_FAILED',
        resource_type: 'CONVERSION_JOB',
        resource_id: jobId,
        summary: `Failed to extract text from ${filename}: ${errMsg}`,
        details: { sourcePath: canonicalSource, error: errMsg, durationMs }
      });

      return {
        success: false,
        jobId,
        sourcePath: canonicalSource,
        sourceSizeBytes,
        inputFormat: ext,
        outputFormat: cleanTarget,
        durationMs,
        error: errMsg
      };
    }
  }
}
