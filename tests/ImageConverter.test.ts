import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import sharp from 'sharp';
import { ImageConverter } from '../src/main/converter/ImageConverter';
import { DatabaseService } from '../src/main/database/DatabaseService';

describe('ImageConverter Engine - Real Image Conversion MVP', () => {
  let tempDir: string;
  let dbPath: string;
  let dbService: DatabaseService;
  let converter: ImageConverter;

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'radial-img-test-')));
    dbPath = path.join(tempDir, 'test.db');
    dbService = new DatabaseService(dbPath);
    await dbService.initialize();
    converter = new ImageConverter(dbService);
  });

  afterEach(async () => {
    try {
      dbService.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Magic-byte format detection', () => {
    it('detects PNG from file magic bytes regardless of extension', async () => {
      const pngPath = path.join(tempDir, 'fake.txt');
      const pngBuffer = await sharp({
        create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
      }).png().toBuffer();
      fs.writeFileSync(pngPath, pngBuffer);

      const detected = await converter.detectFormat(pngPath);
      expect(detected).toBe('png');
    });

    it('detects JPEG from file magic bytes', async () => {
      const jpgPath = path.join(tempDir, 'sample.jpg');
      const jpgBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 255, b: 0 } }
      }).jpeg().toBuffer();
      fs.writeFileSync(jpgPath, jpgBuffer);

      const detected = await converter.detectFormat(jpgPath);
      expect(detected).toBe('jpeg');
    });

    it('detects WebP from file magic bytes', async () => {
      const webpPath = path.join(tempDir, 'sample.webp');
      const webpBuffer = await sharp({
        create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } }
      }).webp().toBuffer();
      fs.writeFileSync(webpPath, webpBuffer);

      const detected = await converter.detectFormat(webpPath);
      expect(detected).toBe('webp');
    });

    it('detects TIFF from file magic bytes', async () => {
      const tiffPath = path.join(tempDir, 'sample.tiff');
      const tiffBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 128, g: 128, b: 128 } }
      }).tiff().toBuffer();
      fs.writeFileSync(tiffPath, tiffBuffer);

      const detected = await converter.detectFormat(tiffPath);
      expect(detected).toBe('tiff');
    });

    it('rejects text files or corrupt files pretending to be images', async () => {
      const fakeImagePath = path.join(tempDir, 'corrupt.png');
      fs.writeFileSync(fakeImagePath, 'This is definitely not an image, just plain ASCII text');

      await expect(converter.detectFormat(fakeImagePath)).rejects.toThrow(
        /Unsupported image format or corrupt header/
      );
    });
  });

  describe('Real raster-to-raster conversions', () => {
    it('converts PNG with alpha transparency to JPEG (flattening to white background)', async () => {
      const sourcePath = path.join(tempDir, 'transparent.png');
      const initialPng = await sharp({
        create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } }
      }).png().toBuffer();
      fs.writeFileSync(sourcePath, initialPng);

      const result = await converter.convert({
        sourcePath,
        targetFormat: 'jpeg',
        quality: 90
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
      expect(fs.existsSync(result.outputPath!)).toBe(true);
      expect(fs.existsSync(sourcePath)).toBe(true); // Source untouched

      // Validate output is valid JPEG
      const outputFormat = await converter.detectFormat(result.outputPath!);
      expect(outputFormat).toBe('jpeg');

      const outStat = fs.statSync(result.outputPath!);
      expect(outStat.size).toBeGreaterThan(0);
      expect(result.outputSizeBytes).toBe(outStat.size);
    });

    it('converts JPEG to WebP with custom quality', async () => {
      const sourcePath = path.join(tempDir, 'source.jpg');
      const jpgBuffer = await sharp({
        create: { width: 30, height: 30, channels: 3, background: { r: 50, g: 100, b: 150 } }
      }).jpeg().toBuffer();
      fs.writeFileSync(sourcePath, jpgBuffer);

      const result = await converter.convert({
        sourcePath,
        targetFormat: 'webp',
        quality: 80
      });

      expect(result.success).toBe(true);
      expect(result.outputPath!.endsWith('.webp')).toBe(true);
      expect(await converter.detectFormat(result.outputPath!)).toBe('webp');
    });

    it('converts WebP to PNG preserving dimensions', async () => {
      const sourcePath = path.join(tempDir, 'image.webp');
      const webpBuffer = await sharp({
        create: { width: 40, height: 25, channels: 4, background: { r: 10, g: 200, b: 80, alpha: 1 } }
      }).webp().toBuffer();
      fs.writeFileSync(sourcePath, webpBuffer);

      const result = await converter.convert({
        sourcePath,
        targetFormat: 'png'
      });

      expect(result.success).toBe(true);
      expect(result.outputPath!.endsWith('.png')).toBe(true);
      expect(await converter.detectFormat(result.outputPath!)).toBe('png');

      const meta = await sharp(result.outputPath!).metadata();
      expect(meta.width).toBe(40);
      expect(meta.height).toBe(25);
    });

    it('converts PNG to BMP and BMP to TIFF', async () => {
      const pngPath = path.join(tempDir, 'input.png');
      const pngBuffer = await sharp({
        create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 255, b: 0, alpha: 1 } }
      }).png().toBuffer();
      fs.writeFileSync(pngPath, pngBuffer);

      // Convert PNG -> BMP
      const bmpResult = await converter.convert({
        sourcePath: pngPath,
        targetFormat: 'bmp'
      });
      expect(bmpResult.success).toBe(true);
      expect(bmpResult.outputPath!.endsWith('.bmp')).toBe(true);
      expect(await converter.detectFormat(bmpResult.outputPath!)).toBe('bmp');

      // Convert BMP -> TIFF
      const tiffResult = await converter.convert({
        sourcePath: bmpResult.outputPath!,
        targetFormat: 'tiff'
      });
      expect(tiffResult.success).toBe(true);
      expect(tiffResult.outputPath!.endsWith('.tiff')).toBe(true);
      expect(await converter.detectFormat(tiffResult.outputPath!)).toBe('tiff');
    });
  });

  describe('Source file safety & Collision avoidance', () => {
    it('never overwrites existing destination file, creates unique incremented name', async () => {
      const sourcePath = path.join(tempDir, 'photo.png');
      const existingOut = path.join(tempDir, 'photo.webp');

      const pngBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 10, g: 10, b: 10 } }
      }).png().toBuffer();
      fs.writeFileSync(sourcePath, pngBuffer);

      // Pre-create the destination file with dummy content
      fs.writeFileSync(existingOut, 'ORIGINAL PRE-EXISTING WEBP CONTENT');

      const result = await converter.convert({
        sourcePath,
        targetFormat: 'webp'
      });

      expect(result.success).toBe(true);
      // Ensure the pre-existing file was NOT touched
      expect(fs.readFileSync(existingOut, 'utf-8')).toBe('ORIGINAL PRE-EXISTING WEBP CONTENT');

      // The new file should have been named photo (1).webp
      expect(result.outputPath).toBe(path.join(tempDir, 'photo (1).webp'));
      expect(fs.existsSync(result.outputPath!)).toBe(true);
    });

    it('cleans up temporary files when conversion fails', async () => {
      const corruptPath = path.join(tempDir, 'corrupt.jpg');
      fs.writeFileSync(corruptPath, 'corrupted header bytes');

      const result = await converter.convert({
        sourcePath: corruptPath,
        targetFormat: 'png'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Ensure no dangling .tmp files in tempDir
      const files = fs.readdirSync(tempDir);
      const tmpFiles = files.filter(f => f.includes('.tmp-'));
      expect(tmpFiles.length).toBe(0);
    });
  });

  describe('Database logging for conversion jobs', () => {
    it('records completed conversion job in conversion_jobs table', async () => {
      const sourcePath = path.join(tempDir, 'tracked.png');
      const pngBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 50, g: 50, b: 50 } }
      }).png().toBuffer();
      fs.writeFileSync(sourcePath, pngBuffer);

      const result = await converter.convert({
        sourcePath,
        targetFormat: 'webp'
      });

      expect(result.success).toBe(true);

      const jobs = await dbService.getConversionJobs(10);
      expect(jobs.length).toBeGreaterThan(0);
      const loggedJob = jobs.find(j => j.id === result.jobId);
      expect(loggedJob).toBeDefined();
      expect(loggedJob?.status).toBe('SUCCEEDED');
      expect(loggedJob?.source_path).toBe(sourcePath);
      expect(loggedJob?.output_path).toBe(result.outputPath);
      expect(loggedJob?.output_format).toBe('webp');
    });

    it('records failed conversion job with error message in database', async () => {
      const badPath = path.join(tempDir, 'invalid.png');
      fs.writeFileSync(badPath, 'bad content');

      const result = await converter.convert({
        sourcePath: badPath,
        targetFormat: 'jpg'
      });

      expect(result.success).toBe(false);

      const jobs = await dbService.getConversionJobs(10);
      const failedJob = jobs.find(j => j.id === result.jobId);
      expect(failedJob).toBeDefined();
      expect(failedJob?.status).toBe('FAILED');
      expect(failedJob?.error_message).toBeDefined();
    });
  });

  describe('Metadata inspection', () => {
    it('retrieves image width, height, format, and channels', async () => {
      const testImg = path.join(tempDir, 'meta.png');
      const pngBuffer = await sharp({
        create: { width: 120, height: 80, channels: 4, background: { r: 0, g: 100, b: 200, alpha: 0.8 } }
      }).png().toBuffer();
      fs.writeFileSync(testImg, pngBuffer);

      const meta = await converter.getImageMetadata(testImg);
      expect(meta.width).toBe(120);
      expect(meta.height).toBe(80);
      expect(meta.format).toBe('png');
      expect(meta.hasAlpha).toBe(true);
      expect(meta.sizeBytes).toBe(pngBuffer.length);
    });
  });
});
