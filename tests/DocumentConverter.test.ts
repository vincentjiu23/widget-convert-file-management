import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseService } from '../src/main/database/DatabaseService';
import { FolderPermissionRegistry } from '../src/main/security/FolderPermissionRegistry';
import { DocumentConverter, isPdfMagicBytes } from '../src/main/converter/DocumentConverter';

describe('DocumentConverter (PDF to TXT Engine & State Integrity)', () => {
  let tempDir: string;
  let dbPath: string;
  let dbService: DatabaseService;
  let permissionRegistry: FolderPermissionRegistry;
  let converter: DocumentConverter;

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
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'radial-doc-test-')));
    dbPath = path.join(tempDir, 'test_doc.sqlite');
    dbService = new DatabaseService(dbPath);
    await dbService.initialize();

    permissionRegistry = new FolderPermissionRegistry(dbService);
    const addRes = permissionRegistry.addFolder(tempDir, 'Test Approved Temp');
    if (!addRes.success) {
      console.error('[ADD FOLDER ERROR]', addRes.error, tempDir);
    }

    converter = new DocumentConverter(dbService, permissionRegistry);
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

  it('validates PDF magic bytes correctly (%PDF-)', () => {
    expect(isPdfMagicBytes(Buffer.from('%PDF-1.4\n'))).toBe(true);
    expect(isPdfMagicBytes(Buffer.from('%PDF-1.7'))).toBe(true);
    expect(isPdfMagicBytes(Buffer.from('GIF89a'))).toBe(false);
    expect(isPdfMagicBytes(Buffer.from('\x89PNG\r\n\x1a\n'))).toBe(false);
    expect(isPdfMagicBytes(Buffer.from(''))).toBe(false);
  });

  it('successfully extracts text from a valid PDF and syncs SQLite database state', async () => {
    // Copy sample PDF into approved temp dir
    const testPdf = path.join(tempDir, 'sample_doc.pdf');
    fs.copyFileSync(validSamplePdfPath, testPdf);

    const result = await converter.convertDocument(testPdf, 'txt');
    expect(result.success).toBe(true);
    expect(result.outputPath).toBeDefined();
    expect(fs.existsSync(result.outputPath!)).toBe(true);
    expect(result.outputPath!.endsWith('.txt')).toBe(true);

    const extractedText = fs.readFileSync(result.outputPath!, 'utf-8');
    expect(extractedText.length).toBeGreaterThan(50);
    expect(result.pageCount).toBeGreaterThan(0);

    // Verify SQLite conversion_jobs table integrity
    const job = dbService.getConversionJobById(result.jobId);
    expect(job).not.toBeNull();
    expect(job?.status).toBe('SUCCEEDED');
    expect(job?.output_path).toBe(result.outputPath);
    expect(job?.progress).toBe(100);
    expect(job?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(job?.completed_at).toBeGreaterThan(0);
    expect(job?.error_message).toBeNull();
  });

  it('enforces collision prevention without overwriting existing files', async () => {
    const testPdf = path.join(tempDir, 'report.pdf');
    fs.copyFileSync(validSamplePdfPath, testPdf);

    // First conversion: produces report.txt
    const res1 = await converter.convertDocument(testPdf, 'txt');
    expect(res1.success).toBe(true);
    expect(path.basename(res1.outputPath!)).toBe('report.txt');

    // Second conversion: must NOT overwrite report.txt, must produce report (1).txt
    const res2 = await converter.convertDocument(testPdf, 'txt');
    expect(res2.success).toBe(true);
    expect(path.basename(res2.outputPath!)).toBe('report (1).txt');
    expect(fs.existsSync(res1.outputPath!)).toBe(true);
    expect(fs.existsSync(res2.outputPath!)).toBe(true);
  });

  it('rejects unsupported target formats honestly without creating fake outputs', async () => {
    const testPdf = path.join(tempDir, 'document.pdf');
    fs.copyFileSync(validSamplePdfPath, testPdf);

    const result = await converter.convertDocument(testPdf, 'docx');
    expect(result.success).toBe(false);
    expect(result.error).toContain('UNSUPPORTED_TARGET_FORMAT');
    expect(result.outputPath).toBeUndefined();

    // Verify job is recorded as UNSUPPORTED in DB
    const job = dbService.getConversionJobById(result.jobId);
    expect(job?.status).toBe('UNSUPPORTED');
  });

  it('handles corrupted PDF files gracefully and records FAILED status in DB', async () => {
    const corruptPdf = path.join(tempDir, 'corrupt.pdf');
    fs.writeFileSync(corruptPdf, Buffer.from('%PDF-corrupt-data-not-a-valid-structure'));

    const result = await converter.convertDocument(corruptPdf, 'txt');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    const job = dbService.getConversionJobById(result.jobId);
    expect(job?.status).toBe('FAILED');
    expect(job?.error_code).toBeDefined();
    expect(job?.error_message).toBeDefined();
  });

  it('rejects files outside approved folders when security registry is active', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radial-outside-'));
    const outsidePdf = path.join(outsideDir, 'unapproved.pdf');
    fs.copyFileSync(validSamplePdfPath, outsidePdf);

    try {
      const result = await converter.convertDocument(outsidePdf, 'txt');
      expect(result.success).toBe(false);
      expect(result.error).toContain('SECURITY_VIOLATION');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('finalizeOutputFile atomically publishes file and cleans up temp staging file', async () => {
    const tempFile = path.join(tempDir, '.tmp_test_atomic.txt');
    fs.writeFileSync(tempFile, 'Atomic document content');

    const published = await converter.finalizeOutputFile(tempFile, tempDir, 'atomic_result', '.txt', 'dummy_source.pdf');

    expect(fs.existsSync(published)).toBe(true);
    expect(fs.readFileSync(published, 'utf-8')).toBe('Atomic document content');
    // Staging temp file must be unlinked
    expect(fs.existsSync(tempFile)).toBe(false);
  });

  it('finalizeOutputFile rejects 0-byte temporary staging file', async () => {
    const emptyTemp = path.join(tempDir, '.tmp_empty.txt');
    fs.writeFileSync(emptyTemp, '');

    await expect(
      converter.finalizeOutputFile(emptyTemp, tempDir, 'empty_result', '.txt', 'dummy_source.pdf')
    ).rejects.toThrow('INVALID_TEMP_FILE');
  });

  it('finalizeOutputFile skips candidate that matches source file path to prevent overwrite', async () => {
    const tempFile = path.join(tempDir, '.tmp_source_check.txt');
    fs.writeFileSync(tempFile, 'New extracted content');

    // The intended output name would collide with the source
    const targetSource = path.join(tempDir, 'sample.txt');
    fs.writeFileSync(targetSource, 'Original source content');

    const published = await converter.finalizeOutputFile(tempFile, tempDir, 'sample', '.txt', targetSource);

    // Must NOT overwrite sample.txt, must publish as sample (1).txt
    expect(path.basename(published)).toBe('sample (1).txt');
    expect(fs.readFileSync(targetSource, 'utf-8')).toBe('Original source content');
    expect(fs.readFileSync(published, 'utf-8')).toBe('New extracted content');
  });
});
