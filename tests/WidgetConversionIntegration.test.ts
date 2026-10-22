import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { DatabaseService } from '../src/main/database/DatabaseService';
import { FolderPermissionRegistry } from '../src/main/security/FolderPermissionRegistry';
import { ImageConverter } from '../src/main/converter/ImageConverter';
import { DocumentConverter } from '../src/main/converter/DocumentConverter';

/**
 * End-to-End Regression Test Suite for Widget Conversion Pipeline
 * Verifies Preload/RadialAPI contracts, convertFile dispatch, real raster & document conversions,
 * corrupted file rejection, unsupported format status, and anti-false-success guarantees.
 */
describe('Widget Conversion & Unified Dispatcher Integration', () => {
  let tempDir: string;
  let dbPath: string;
  let dbService: DatabaseService;
  let permissionRegistry: FolderPermissionRegistry;
  let imageConverter: ImageConverter;
  let documentConverter: DocumentConverter;

  const validSamplePdfPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'pdf-parse',
    'test',
    'data',
    '01-valid.pdf'
  );

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'widget-regress-test-')));
    dbPath = path.join(tempDir, 'test_widget.sqlite');
    dbService = new DatabaseService(dbPath);
    await dbService.initialize();

    permissionRegistry = new FolderPermissionRegistry(dbService);
    permissionRegistry.addFolder(tempDir, 'Widget Test Folder');

    imageConverter = new ImageConverter(dbService, permissionRegistry);
    documentConverter = new DocumentConverter(dbService, permissionRegistry);
  });

  afterEach(() => {
    try {
      dbService.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * Helper simulating the exact conversion:convertFile logic in src/main/ipc.ts
   */
  async function simulateConvertFileIpc(
    sourcePath: string,
    targetFormat: string
  ): Promise<{
    success: boolean;
    jobId?: string;
    sourcePath?: string;
    outputPath?: string;
    error?: string;
    status?: string;
  }> {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      return { success: false, error: 'BAD_REQUEST: sourcePath must be a non-empty string', status: 'FAILED' };
    }
    if (typeof targetFormat !== 'string' || !targetFormat.trim()) {
      return { success: false, error: 'BAD_REQUEST: targetFormat must be a non-empty string', status: 'FAILED' };
    }

    const cleanSource = sourcePath.trim();
    if (!path.isAbsolute(cleanSource)) {
      return {
        success: false,
        error: 'BAD_REQUEST: sourcePath must be an absolute filesystem path. File names without directory paths cannot be converted.',
        status: 'FAILED'
      };
    }

    if (!fs.existsSync(cleanSource)) {
      return {
        success: false,
        error: `FILE_NOT_FOUND: Source file does not exist: ${cleanSource}`,
        status: 'FAILED'
      };
    }

    const cleanTarget = targetFormat.trim().toLowerCase().replace(/^\./, '');
    const ext = path.extname(cleanSource).toLowerCase().replace(/^\./, '');

    const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'];
    const isImage = imageExts.includes(ext);
    const isPdf = ext === 'pdf';

    try {
      if (isImage) {
        return await imageConverter.convertImage(cleanSource, cleanTarget);
      }
      if (isPdf && cleanTarget === 'txt') {
        return await documentConverter.convertDocument(cleanSource, cleanTarget);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Conversion failed: ${msg}`,
        status: 'FAILED'
      };
    }

    // Unsupported conversion request
    const jobId = `job-unsup-${Date.now()}`;
    const filename = path.basename(cleanSource);
    const reason = isPdf
      ? `PDF target format .${cleanTarget.toUpperCase()} is not supported. Currently only PDF to TXT text extraction is available.`
      : `Conversion from .${ext.toUpperCase()} to .${cleanTarget.toUpperCase()} is not supported.`;

    dbService.insertConversionJob({
      id: jobId,
      source_path: cleanSource,
      source_filename: filename,
      input_format: ext || 'unknown',
      output_format: cleanTarget,
      output_path: null,
      status: 'UNSUPPORTED',
      progress: 0,
      created_at: Date.now(),
      completed_at: Date.now(),
      error_code: 'UNSUPPORTED_CONVERSION',
      error_message: reason
    });

    return {
      success: false,
      jobId,
      sourcePath: cleanSource,
      error: reason,
      status: 'UNSUPPORTED'
    };
  }

  describe('A. Preload & RadialAPI Contract Parity', () => {
    it('preload exports convertFile, convertImage, convertDocument, getPathForFile, openFilePicker', () => {
      const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf-8');
      expect(preloadSrc).toContain('convertFile:');
      expect(preloadSrc).toContain('convertImage:');
      expect(preloadSrc).toContain('convertDocument:');
      expect(preloadSrc).toContain('getPathForFile:');
      expect(preloadSrc).toContain('openFilePicker:');
    });

    it('shared RadialAPI interface declares convertFile, openFilePicker, and core methods', () => {
      const typesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'types.ts'), 'utf-8');
      expect(typesSrc).toContain('convertFile:');
      expect(typesSrc).toContain('openFilePicker:');
      expect(typesSrc).toContain('getPathForFile:');
    });

    it('WidgetView component consumes window.radialAPI.convertFile', () => {
      const widgetSrc = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'WidgetView.tsx'),
        'utf-8'
      );
      expect(widgetSrc).toContain('window.radialAPI?.convertFile');
      expect(widgetSrc).not.toContain('mockAPI');
    });

    it('getPathForFile never returns raw file.name when webUtils fails', () => {
      const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf-8');
      // Must not fall back to `return file.name;`
      expect(preloadSrc).not.toContain('return file.name;');
    });
  });

  describe('B. Real Image Conversion via Unified Dispatcher', () => {
    it('successfully converts real PNG to JPEG and produces verified non-empty output', async () => {
      const srcPng = path.join(tempDir, 'test_source.png');
      const pngBuf = await sharp({
        create: { width: 32, height: 32, channels: 4, background: { r: 249, g: 115, b: 22, alpha: 1 } }
      }).png().toBuffer();
      fs.writeFileSync(srcPng, pngBuf);

      const res = await simulateConvertFileIpc(srcPng, 'jpeg');
      expect(res.success).toBe(true);
      expect(res.outputPath).toBeDefined();
      expect(fs.existsSync(res.outputPath!)).toBe(true);

      const stat = fs.statSync(res.outputPath!);
      expect(stat.size).toBeGreaterThan(0);

      // Verify that output is a valid JPEG
      const meta = await sharp(res.outputPath!).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(32);
      expect(meta.height).toBe(32);
    });

    it('successfully converts JPEG to WebP', async () => {
      const srcJpg = path.join(tempDir, 'photo.jpg');
      const jpgBuf = await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 16, g: 185, b: 129 } }
      }).jpeg().toBuffer();
      fs.writeFileSync(srcJpg, jpgBuf);

      const res = await simulateConvertFileIpc(srcJpg, 'webp');
      expect(res.success).toBe(true);
      expect(res.outputPath).toBeDefined();
      expect(fs.existsSync(res.outputPath!)).toBe(true);

      const meta = await sharp(res.outputPath!).metadata();
      expect(meta.format).toBe('webp');
    });
  });

  describe('C. Real Document Conversion (PDF to TXT)', () => {
    it('extracts text from valid PDF and produces valid TXT file', async () => {
      const testPdf = path.join(tempDir, 'valid_doc.pdf');
      fs.copyFileSync(validSamplePdfPath, testPdf);

      const res = await simulateConvertFileIpc(testPdf, 'txt');
      expect(res.success).toBe(true);
      expect(res.outputPath).toBeDefined();
      expect(fs.existsSync(res.outputPath!)).toBe(true);

      const text = fs.readFileSync(res.outputPath!, 'utf-8');
      expect(text.trim().length).toBeGreaterThan(0);
      expect(res.outputPath!.endsWith('.txt')).toBe(true);
    });
  });

  describe('D. Error Handling & Rejection Guarantees', () => {
    it('rejects relative path or bare filename with clear informative error', async () => {
      const res = await simulateConvertFileIpc('bare_filename.png', 'jpeg');
      expect(res.success).toBe(false);
      expect(res.error).toContain('BAD_REQUEST');
      expect(res.error).toContain('absolute');
    });

    it('rejects non-existent file path with FILE_NOT_FOUND', async () => {
      const fakePath = path.join(tempDir, 'non_existent_file.png');
      const res = await simulateConvertFileIpc(fakePath, 'jpeg');
      expect(res.success).toBe(false);
      expect(res.error).toContain('FILE_NOT_FOUND');
    });

    it('returns UNSUPPORTED status for unsupported format requests and writes DB entry', async () => {
      const testPdf = path.join(tempDir, 'sample_unsupported.pdf');
      fs.copyFileSync(validSamplePdfPath, testPdf);

      // PDF to PNG is not implemented
      const res = await simulateConvertFileIpc(testPdf, 'png');
      expect(res.success).toBe(false);
      expect(res.status).toBe('UNSUPPORTED');
      expect(res.error).toContain('not supported');

      // Check SQLite database records UNSUPPORTED status
      const jobs = dbService.getConversionJobs(10);
      const unsupJob = jobs.find((j) => j.source_filename === 'sample_unsupported.pdf');
      expect(unsupJob).toBeDefined();
      expect(unsupJob?.status).toBe('UNSUPPORTED');
    });

    it('rejects corrupted image file without claiming success', async () => {
      const badImg = path.join(tempDir, 'corrupt.png');
      fs.writeFileSync(badImg, Buffer.from('NOT_A_REAL_PNG_HEADER'));

      const res = await simulateConvertFileIpc(badImg, 'jpeg');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects corrupted PDF file without claiming success', async () => {
      const badPdf = path.join(tempDir, 'corrupt.pdf');
      fs.writeFileSync(badPdf, Buffer.from('FAKE_PDF_HEADER_NOT_REAL'));

      const res = await simulateConvertFileIpc(badPdf, 'txt');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe('E. Anti-Overwrite & Destination Integrity', () => {
    it('applies numeric collision increment when destination file already exists', async () => {
      const srcPng = path.join(tempDir, 'document.png');
      const pngBuf = await sharp({
        create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } }
      }).png().toBuffer();
      fs.writeFileSync(srcPng, pngBuf);

      // Pre-create destination file (.jpg is the extension for format jpeg)
      const existingJpg = path.join(tempDir, 'document.jpg');
      fs.writeFileSync(existingJpg, 'PRE-EXISTING CONTENT');

      const res = await simulateConvertFileIpc(srcPng, 'jpeg');
      expect(res.success).toBe(true);
      expect(res.outputPath).not.toBe(existingJpg);
      expect(res.outputPath).toContain('document (1).jpg');

      // Pre-existing file was NOT overwritten
      expect(fs.readFileSync(existingJpg, 'utf-8')).toBe('PRE-EXISTING CONTENT');
    });
  });
});
