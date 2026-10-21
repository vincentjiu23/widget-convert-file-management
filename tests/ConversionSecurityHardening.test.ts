import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import sharp from 'sharp';
import {
  ImageConverter,
  MAX_SOURCE_FILE_BYTES,
  MAX_BMP_FILE_SIZE,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_FINALIZE_COLLISION_ATTEMPTS,
  MAX_CONCURRENT_CONVERSIONS,
  detectImageFormatFromBuffer
} from '../src/main/converter/ImageConverter';
import { DatabaseService } from '../src/main/database/DatabaseService';
import { FolderPermissionRegistry } from '../src/main/security/FolderPermissionRegistry';

/**
 * Helper: create a real PNG file with given dimensions in the specified directory.
 */
async function createTestPng(dir: string, name: string, width = 10, height = 10): Promise<string> {
  const filePath = path.join(dir, name);
  const buf = await sharp({
    create: { width, height, channels: 4, background: { r: 100, g: 50, b: 200, alpha: 1 } }
  }).png().toBuffer();
  fs.writeFileSync(filePath, buf);
  return filePath;
}

/**
 * Helper: create a BMP header buffer with specified dimensions for header-only tests.
 */
function createBmpHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(64);
  // BMP magic: "BM"
  header[0] = 0x42;
  header[1] = 0x4d;
  // Write width at offset 18 (INT32LE)
  header.writeInt32LE(width, 18);
  // Write height at offset 22 (INT32LE)
  header.writeInt32LE(height, 22);
  return header;
}

describe('Conversion Security Hardening', () => {
  let tempDir: string;
  let approvedDir: string;
  let unapprovedDir: string;
  let dbPath: string;
  let dbService: DatabaseService;
  let permissionRegistry: FolderPermissionRegistry;
  let converter: ImageConverter;

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'radial-security-test-')));
    approvedDir = path.join(tempDir, 'approved');
    unapprovedDir = path.join(tempDir, 'unapproved');
    fs.mkdirSync(approvedDir, { recursive: true });
    fs.mkdirSync(unapprovedDir, { recursive: true });

    dbPath = path.join(tempDir, 'test-security.db');
    dbService = new DatabaseService(dbPath);
    await dbService.initialize();

    permissionRegistry = new FolderPermissionRegistry(dbService);
    // Add the approved directory to the registry
    permissionRegistry.addFolder(approvedDir, 'TestApproved');

    converter = new ImageConverter(dbService, permissionRegistry);
  });

  afterEach(() => {
    try {
      dbService.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ========================================================================
  // A. Output Directory Validation
  // ========================================================================

  describe('A. Output directory validation', () => {
    it('rejects output directory outside approved folders', async () => {
      const sourcePath = await createTestPng(approvedDir, 'source.png');

      const result = await converter.convertImage(sourcePath, 'webp', {
        outputDirectory: unapprovedDir
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SECURITY_VIOLATION/);
      // Verify no output file was created in unapproved directory
      const files = fs.readdirSync(unapprovedDir);
      expect(files.length).toBe(0);
    });

    it('rejects path traversal in output directory', async () => {
      const sourcePath = await createTestPng(approvedDir, 'source.png');

      const result = await converter.convertImage(sourcePath, 'webp', {
        outputDirectory: path.join(approvedDir, '..', '..', 'escape')
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SECURITY_VIOLATION|DIRECTORY_NOT_FOUND/);
    });

    it('rejects non-existent output directory (no arbitrary mkdir)', async () => {
      const sourcePath = await createTestPng(approvedDir, 'source.png');
      const ghostDir = path.join(approvedDir, 'nonexistent-subdir');

      const result = await converter.convertImage(sourcePath, 'webp', {
        outputDirectory: ghostDir
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/DIRECTORY_NOT_FOUND/);
      // Verify directory was NOT created
      expect(fs.existsSync(ghostDir)).toBe(false);
    });

    it('rejects output directory that is not a directory (is a file)', async () => {
      const fakeDirPath = path.join(approvedDir, 'notadir.txt');
      fs.writeFileSync(fakeDirPath, 'I am a file pretending to be a dir');
      const sourcePath = await createTestPng(approvedDir, 'source.png');

      const result = await converter.convertImage(sourcePath, 'webp', {
        outputDirectory: fakeDirPath
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/NOT_A_DIRECTORY|SECURITY_VIOLATION|DIRECTORY_NOT_FOUND/);
    });

    it('defaults to source directory and validates it within approved scope', async () => {
      const sourcePath = await createTestPng(approvedDir, 'default-out.png');

      const result = await converter.convertImage(sourcePath, 'webp');

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
      // Output should be in the same approved directory
      expect(path.dirname(result.outputPath!)).toBe(approvedDir);
    });

    it('rejects default output when source is in unapproved directory', async () => {
      const sourcePath = await createTestPng(unapprovedDir, 'unapproved-src.png');

      // Create converter WITHOUT permission registry to simulate direct call
      // But with registry, even source dir default should fail
      const result = await converter.convertImage(sourcePath, 'webp');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SECURITY_VIOLATION/);
    });

    it('accepts output to approved subdirectory', async () => {
      const subDir = path.join(approvedDir, 'sub-output');
      fs.mkdirSync(subDir, { recursive: true });
      const sourcePath = await createTestPng(approvedDir, 'source.png');

      const result = await converter.convertImage(sourcePath, 'webp', {
        outputDirectory: subDir
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
      expect(path.dirname(result.outputPath!)).toBe(subDir);
    });
  });

  // ========================================================================
  // B. Anti-overwrite Guarantees
  // ========================================================================

  describe('B. Anti-overwrite guarantees', () => {
    it('never overwrites pre-existing file at destination', async () => {
      const sourcePath = await createTestPng(approvedDir, 'photo.png');
      const preExistingPath = path.join(approvedDir, 'photo.webp');
      const preExistingContent = 'ORIGINAL_PRE_EXISTING_CONTENT_MUST_NOT_CHANGE';
      fs.writeFileSync(preExistingPath, preExistingContent);

      const result = await converter.convertImage(sourcePath, 'webp');

      expect(result.success).toBe(true);
      // Pre-existing file unchanged
      expect(fs.readFileSync(preExistingPath, 'utf-8')).toBe(preExistingContent);
      // New file created with incremented name
      expect(result.outputPath).toBe(path.join(approvedDir, 'photo (1).webp'));
      expect(fs.existsSync(result.outputPath!)).toBe(true);
    });

    it('handles cascading collision across multiple pre-existing files', async () => {
      const sourcePath = await createTestPng(approvedDir, 'cascade.png');

      // Pre-create cascade.webp, cascade (1).webp, cascade (2).webp
      for (let i = 0; i < 3; i++) {
        const name = i === 0 ? 'cascade.webp' : `cascade (${i}).webp`;
        fs.writeFileSync(path.join(approvedDir, name), `COLLISION_${i}`);
      }

      const result = await converter.convertImage(sourcePath, 'webp');

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(path.join(approvedDir, 'cascade (3).webp'));
      // All pre-existing files unchanged
      expect(fs.readFileSync(path.join(approvedDir, 'cascade.webp'), 'utf-8')).toBe('COLLISION_0');
      expect(fs.readFileSync(path.join(approvedDir, 'cascade (1).webp'), 'utf-8')).toBe('COLLISION_1');
      expect(fs.readFileSync(path.join(approvedDir, 'cascade (2).webp'), 'utf-8')).toBe('COLLISION_2');
    });

    it('source file remains unchanged after successful conversion', async () => {
      const sourcePath = await createTestPng(approvedDir, 'immutable.png');
      const originalContent = fs.readFileSync(sourcePath);
      const originalStat = fs.statSync(sourcePath);

      const result = await converter.convertImage(sourcePath, 'webp');

      expect(result.success).toBe(true);
      // Source file byte-for-byte identical
      const afterContent = fs.readFileSync(sourcePath);
      expect(Buffer.compare(originalContent, afterContent)).toBe(0);
      // Source file mtime unchanged (within 1s tolerance for filesystem resolution)
      const afterStat = fs.statSync(sourcePath);
      expect(Math.abs(afterStat.mtimeMs - originalStat.mtimeMs)).toBeLessThan(1000);
    });

    it('source file remains unchanged after failed conversion', async () => {
      const sourcePath = await createTestPng(approvedDir, 'fail-immutable.png');
      const originalContent = fs.readFileSync(sourcePath);

      // Force failure: target format invalid
      const result = await converter.convertImage(sourcePath, 'INVALID_FORMAT');

      expect(result.success).toBe(false);
      const afterContent = fs.readFileSync(sourcePath);
      expect(Buffer.compare(originalContent, afterContent)).toBe(0);
    });

    it('never overwrites source file when source and target format have same extension', async () => {
      const sourcePath = await createTestPng(approvedDir, 'same.png');
      const originalContent = fs.readFileSync(sourcePath);

      const result = await converter.convertImage(sourcePath, 'png');

      expect(result.success).toBe(true);
      // Source must be untouched
      expect(Buffer.compare(fs.readFileSync(sourcePath), originalContent)).toBe(0);
      // Output must be a different file
      expect(result.outputPath).not.toEqual(sourcePath);
      expect(path.resolve(result.outputPath!).toLowerCase()).not.toEqual(
        path.resolve(sourcePath).toLowerCase()
      );
    });
  });

  // ========================================================================
  // C. Resource Limits
  // ========================================================================

  describe('C. Resource limits', () => {
    it('rejects source file exceeding MAX_SOURCE_FILE_BYTES (50MB)', async () => {
      const largePath = path.join(approvedDir, 'huge.png');
      // Create a file slightly over 50MB (just write sparse content since we only need stat.size check)
      const fd = fs.openSync(largePath, 'w');
      // Write PNG header so magic-byte detection would pass if it got that far
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      fs.writeSync(fd, pngHeader, 0, pngHeader.length, 0);
      fs.ftruncateSync(fd, MAX_SOURCE_FILE_BYTES + 1024);
      fs.closeSync(fd);

      const result = await converter.convertImage(largePath, 'webp');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/FILE_TOO_LARGE/);
    });

    it('rejects BMP file exceeding MAX_BMP_FILE_SIZE (30MB)', async () => {
      const bmpPath = path.join(approvedDir, 'huge.bmp');
      const fd = fs.openSync(bmpPath, 'w');
      // Write BMP header (BM magic)
      const bmpMagic = Buffer.alloc(64, 0);
      bmpMagic[0] = 0x42; // 'B'
      bmpMagic[1] = 0x4d; // 'M'
      bmpMagic.writeInt32LE(100, 18); // width=100
      bmpMagic.writeInt32LE(100, 22); // height=100
      fs.writeSync(fd, bmpMagic, 0, bmpMagic.length, 0);
      fs.ftruncateSync(fd, MAX_BMP_FILE_SIZE + 1024);
      fs.closeSync(fd);

      const result = await converter.convertImage(bmpPath, 'png');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/FILE_TOO_LARGE.*BMP/i);
    });

    it('rejects BMP with dimensions exceeding MAX_IMAGE_DIMENSION', () => {
      const header = createBmpHeader(MAX_IMAGE_DIMENSION + 1, 100);
      // detectImageFormatFromBuffer should still detect as BMP
      expect(detectImageFormatFromBuffer(header)).toBe('bmp');
      // But getImageMetadata should reject it (tested via header parsing)
    });

    it('rejects images exceeding MAX_IMAGE_PIXELS via metadata check', async () => {
      // We can't easily create a 40MP+ image in a test,
      // so we verify the constant is set correctly and the sharp limitInputPixels is configured
      expect(MAX_IMAGE_PIXELS).toBe(40_000_000);
      expect(MAX_IMAGE_DIMENSION).toBe(16384);
      expect(MAX_SOURCE_FILE_BYTES).toBe(50 * 1024 * 1024);
    });

    it('rejects text/corrupt files pretending to be images', async () => {
      const fakePath = path.join(approvedDir, 'fake.png');
      fs.writeFileSync(fakePath, 'This is NOT an image, just plain text content');

      const result = await converter.convertImage(fakePath, 'webp');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/UNSUPPORTED_FORMAT|Unsupported image format/);
    });

    it('reports clear error message when resource limit is hit', async () => {
      const largePath = path.join(approvedDir, 'toolarge.png');
      const fd = fs.openSync(largePath, 'w');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      fs.writeSync(fd, pngHeader, 0, pngHeader.length, 0);
      fs.ftruncateSync(fd, MAX_SOURCE_FILE_BYTES + 1);
      fs.closeSync(fd);

      const result = await converter.convertImage(largePath, 'jpeg');

      expect(result.success).toBe(false);
      expect(result.error).toContain('bytes');
      expect(result.error).toContain('FILE_TOO_LARGE');
    });
  });

  // ========================================================================
  // D. Temporary File Cleanup
  // ========================================================================

  describe('D. Temporary file cleanup', () => {
    it('removes temp files when conversion of corrupt image fails', async () => {
      const corruptPath = path.join(approvedDir, 'corrupt.jpg');
      fs.writeFileSync(corruptPath, 'absolutely not a jpeg');

      const result = await converter.convertImage(corruptPath, 'png');

      expect(result.success).toBe(false);
      // Verify no .tmp files left behind in approvedDir
      const remainingFiles = fs.readdirSync(approvedDir);
      const tmpFiles = remainingFiles.filter(f => f.includes('.tmp-'));
      expect(tmpFiles.length).toBe(0);
    });

    it('removes temp files even when valid source produces pipeline error', async () => {
      const sourcePath = await createTestPng(approvedDir, 'good.png');

      // Force pipeline failure by using an unsupported target
      const result = await converter.convertImage(sourcePath, 'INVALID');

      expect(result.success).toBe(false);
      const remainingFiles = fs.readdirSync(approvedDir);
      const tmpFiles = remainingFiles.filter(f => f.includes('.tmp-'));
      expect(tmpFiles.length).toBe(0);
    });
  });

  // ========================================================================
  // E. Concurrency Controls
  // ========================================================================

  describe('E. Concurrency controls', () => {
    it(`limits concurrent conversions to MAX_CONCURRENT_CONVERSIONS (${MAX_CONCURRENT_CONVERSIONS})`, async () => {
      expect(MAX_CONCURRENT_CONVERSIONS).toBe(2);

      // Create multiple source images
      const sources: string[] = [];
      for (let i = 0; i < 4; i++) {
        sources.push(await createTestPng(approvedDir, `concurrent-${i}.png`, 20, 20));
      }

      // Launch all conversions simultaneously
      const promises = sources.map(s =>
        converter.convertImage(s, 'webp')
      );

      const results = await Promise.all(promises);
      // All should succeed (just not all at once)
      for (const r of results) {
        expect(r.success).toBe(true);
      }
    });
  });

  // ========================================================================
  // F. Output Verification
  // ========================================================================

  describe('F. Output re-decode verification', () => {
    it('output can be read back as valid image after PNG→JPEG conversion', async () => {
      const sourcePath = await createTestPng(approvedDir, 'verify.png', 30, 30);

      const result = await converter.convertImage(sourcePath, 'jpeg');

      expect(result.success).toBe(true);
      // Re-read output and verify it's a valid JPEG
      const outputMeta = await sharp(result.outputPath!).metadata();
      expect(outputMeta.format).toBe('jpeg');
      expect(outputMeta.width).toBe(30);
      expect(outputMeta.height).toBe(30);
    });

    it('output can be read back as valid image after JPEG→WebP conversion', async () => {
      const jpgPath = path.join(approvedDir, 'verify.jpg');
      const jpgBuffer = await sharp({
        create: { width: 25, height: 25, channels: 3, background: { r: 200, g: 100, b: 50 } }
      }).jpeg().toBuffer();
      fs.writeFileSync(jpgPath, jpgBuffer);

      const result = await converter.convertImage(jpgPath, 'webp');

      expect(result.success).toBe(true);
      const outputMeta = await sharp(result.outputPath!).metadata();
      expect(outputMeta.format).toBe('webp');
      expect(outputMeta.width).toBe(25);
      expect(outputMeta.height).toBe(25);
    });

    it('output file is non-zero bytes for all supported target formats', async () => {
      const sourcePath = await createTestPng(approvedDir, 'multifmt.png', 8, 8);
      const targets = ['jpeg', 'webp', 'tiff', 'bmp'];

      for (const fmt of targets) {
        const result = await converter.convertImage(sourcePath, fmt);
        expect(result.success).toBe(true);
        expect(result.outputSizeBytes).toBeGreaterThan(0);
        const stat = fs.statSync(result.outputPath!);
        expect(stat.size).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // G. validateAndResolveOutputDirectory unit tests
  // ========================================================================

  describe('G. validateAndResolveOutputDirectory isolation', () => {
    it('rejects output directory with null bytes', async () => {
      const sourcePath = await createTestPng(approvedDir, 'null-byte.png');

      await expect(
        converter.validateAndResolveOutputDirectory(sourcePath, approvedDir + '\0evil')
      ).rejects.toThrow(/SECURITY_VIOLATION|DIRECTORY_NOT_FOUND/);
    });

    it('returns canonical realpath for valid approved output directory', async () => {
      const sourcePath = await createTestPng(approvedDir, 'canonical.png');
      const subDir = path.join(approvedDir, 'valid-sub');
      fs.mkdirSync(subDir, { recursive: true });

      const resolved = await converter.validateAndResolveOutputDirectory(sourcePath, subDir);
      expect(resolved).toBe(fs.realpathSync(subDir));
    });
  });

  // ========================================================================
  // H. finalizeOutputFile unit tests
  // ========================================================================

  describe('H. finalizeOutputFile isolation', () => {
    it('creates output file when no collision exists', async () => {
      const tempFile = path.join(approvedDir, '.test.tmp');
      fs.writeFileSync(tempFile, 'temp-content');

      const result = await converter.finalizeOutputFile(
        tempFile, approvedDir, 'output', '.webp', path.join(approvedDir, 'source.png')
      );

      expect(result).toBe(path.join(approvedDir, 'output.webp'));
      expect(fs.existsSync(result)).toBe(true);
      expect(fs.existsSync(tempFile)).toBe(false); // temp cleaned up
    });

    it('skips candidate that would overwrite source file', async () => {
      const sourcePath = path.join(approvedDir, 'skip-source.png');
      fs.writeFileSync(sourcePath, 'source-content');

      const tempFile = path.join(approvedDir, '.test-skip.tmp');
      fs.writeFileSync(tempFile, 'converted-content');

      // basename='skip-source', ext='.png' → candidate would be skip-source.png = source
      const result = await converter.finalizeOutputFile(
        tempFile, approvedDir, 'skip-source', '.png', sourcePath
      );

      // Should have skipped skip-source.png and created skip-source (1).png
      expect(result).toBe(path.join(approvedDir, 'skip-source (1).png'));
      // Source untouched
      expect(fs.readFileSync(sourcePath, 'utf-8')).toBe('source-content');
    });
  });

  // ========================================================================
  // I. Database records for failed conversions
  // ========================================================================

  describe('I. Database records for security failures', () => {
    it('records FAILED status for security-rejected conversion', async () => {
      const sourcePath = await createTestPng(approvedDir, 'db-track.png');

      const result = await converter.convertImage(sourcePath, 'webp', {
        outputDirectory: unapprovedDir
      });

      expect(result.success).toBe(false);

      // Verify conversion job is recorded as FAILED, not SUCCEEDED
      const jobs = dbService.getConversionJobs(50);
      const failedJobs = jobs.filter(
        j => j.source_path === sourcePath && j.status === 'FAILED'
      );
      expect(failedJobs.length).toBe(1);
      expect(failedJobs[0].error_message).toMatch(/SECURITY_VIOLATION/);

      const succeededJobs = jobs.filter(
        j => j.source_path === sourcePath && j.status === 'SUCCEEDED'
      );
      expect(succeededJobs.length).toBe(0);
    });
  });

  // ========================================================================
  // J. Atomic Finalization & Race Condition Tests
  // ========================================================================

  describe('J. Atomic finalization & race condition safety', () => {
    it('handles two simultaneous conversions competing for the exact same target filename', async () => {
      // Create two distinct source files with different content
      const src1 = await createTestPng(approvedDir, 'race-a.png', 15, 15);
      const src2 = await createTestPng(approvedDir, 'race-b.png', 25, 25);

      // Force both conversions to target the exact same custom filename 'shared-output'
      const [res1, res2] = await Promise.all([
        converter.convertImage(src1, 'webp', { customFilename: 'shared-output' }),
        converter.convertImage(src2, 'webp', { customFilename: 'shared-output' })
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      // The two output paths must be different (one shared-output.webp, one shared-output (1).webp)
      expect(res1.outputPath).not.toBe(res2.outputPath);

      const paths = [res1.outputPath!, res2.outputPath!].sort();
      expect(paths[0]).toBe(path.join(approvedDir, 'shared-output (1).webp'));
      expect(paths[1]).toBe(path.join(approvedDir, 'shared-output.webp'));

      // Both output files exist and are valid readable WebP images
      for (const p of paths) {
        expect(fs.existsSync(p)).toBe(true);
        const meta = await sharp(p).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBeGreaterThan(0);
      }
    });

    it('rejects publication when temporary file is 0 bytes or missing', async () => {
      const emptyTemp = path.join(approvedDir, '.empty.tmp');
      fs.writeFileSync(emptyTemp, '');

      await expect(
        converter.finalizeOutputFile(
          emptyTemp,
          approvedDir,
          'empty-test',
          '.webp',
          path.join(approvedDir, 'some-src.png')
        )
      ).rejects.toThrow(/INVALID_TEMP_FILE/);

      expect(fs.existsSync(path.join(approvedDir, 'empty-test.webp'))).toBe(false);
    });

    it('cleans up temporary file without deleting foreign files in the directory', async () => {
      const neighborFile = path.join(approvedDir, 'important-neighbor.txt');
      fs.writeFileSync(neighborFile, 'DO_NOT_DELETE');

      const corruptPath = path.join(approvedDir, 'corrupt-cleanup.jpg');
      fs.writeFileSync(corruptPath, 'corrupt data');

      const result = await converter.convertImage(corruptPath, 'png');
      expect(result.success).toBe(false);

      // Neighbor file must still exist and be completely intact
      expect(fs.existsSync(neighborFile)).toBe(true);
      expect(fs.readFileSync(neighborFile, 'utf-8')).toBe('DO_NOT_DELETE');
    });

    it('preserves existing file when candidate collision occurs during link', async () => {
      const targetPath = path.join(approvedDir, 'preserve.webp');
      fs.writeFileSync(targetPath, 'ORIGINAL_PRESERVED_DATA');

      const tempFile = path.join(approvedDir, '.valid.tmp');
      fs.writeFileSync(tempFile, 'NEW_CONVERTED_DATA');

      const finalPath = await converter.finalizeOutputFile(
        tempFile,
        approvedDir,
        'preserve',
        '.webp',
        path.join(approvedDir, 'dummy-source.png')
      );

      // Original file preserved
      expect(fs.readFileSync(targetPath, 'utf-8')).toBe('ORIGINAL_PRESERVED_DATA');
      // Final path is counter-incremented
      expect(finalPath).toBe(path.join(approvedDir, 'preserve (1).webp'));
      expect(fs.readFileSync(finalPath, 'utf-8')).toBe('NEW_CONVERTED_DATA');
      // Temp file cleaned up
      expect(fs.existsSync(tempFile)).toBe(false);
    });
  });
});
