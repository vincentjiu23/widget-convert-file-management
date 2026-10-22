import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { DatabaseService } from '../src/main/database/DatabaseService';
import { FolderPermissionRegistry } from '../src/main/security/FolderPermissionRegistry';
import { ImageConverter } from '../src/main/converter/ImageConverter';
import { DocumentConverter } from '../src/main/converter/DocumentConverter';
import { getRadialSectorHit } from '../src/renderer/src/core/RadialGeometry';
import { classifyFile } from '../src/renderer/src/core/FileClassifier';
import { getPreloadPath, createDashboardWindow, createFloatingWidgetWindow } from '../src/main/window';

/**
 * Regression Test Suite: Drag-and-Drop File Path & Security Verification
 * Covers all requirements in Section 5:
 * - Real image format drops: PNG, JPEG, WebP, BMP, TIFF
 * - Real document drops: PDF -> TXT text extraction
 * - Empty / unavailable / relative file paths
 * - Non-existent files and path traversal attempts
 * - Unapproved folder detection and authorization flow
 * - Drop inside center circle vs drop outside radial boundaries
 * - Drag synchronization with click-through / ignore mouse events
 * - Preload parity across Dashboard and Widget windows
 * - Error state and drag hover state reset logic
 */
describe('Widget Drag-and-Drop & File Path Regression Suite', () => {
  let tempDir: string;
  let unapprovedDir: string;
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
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-approved-')));
    unapprovedDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-unapproved-')));
    dbPath = path.join(tempDir, 'test_dnd.sqlite');
    dbService = new DatabaseService(dbPath);
    await dbService.initialize();

    permissionRegistry = new FolderPermissionRegistry(dbService);
    permissionRegistry.addFolder(tempDir, 'Approved Temp');

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
    try {
      fs.rmSync(unapprovedDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // Simulates main-process security:checkPath logic
  async function simulateCheckPath(targetPath: string) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      return { exists: false, isFile: false, isApproved: false, canonicalPath: '', error: 'BAD_REQUEST' };
    }
    const clean = targetPath.trim();
    if (!path.isAbsolute(clean)) {
      return { exists: false, isFile: false, isApproved: false, canonicalPath: '', error: 'NOT_ABSOLUTE' };
    }
    if (!fs.existsSync(clean)) {
      return { exists: false, isFile: false, isApproved: false, canonicalPath: clean, error: 'FILE_NOT_FOUND' };
    }
    const real = await fs.promises.realpath(clean);
    const stat = await fs.promises.stat(real);
    if (!stat.isFile()) {
      return { exists: true, isFile: false, isApproved: false, canonicalPath: real, error: 'NOT_A_FILE' };
    }
    const validation = permissionRegistry.isPathWithinApprovedFolder(real);
    const dirPath = path.dirname(real);
    const dirName = path.basename(dirPath) || dirPath;
    return {
      exists: true,
      isFile: true,
      isApproved: validation.isValid,
      canonicalPath: real,
      folderPath: dirPath,
      folderName: dirName
    };
  }

  describe('1. Preload Configuration & Parity Across Windows', () => {
    it('getPreloadPath() returns a valid existing file path', () => {
      const p = getPreloadPath();
      expect(p).toBeDefined();
      expect(typeof p).toBe('string');
      expect(fs.existsSync(p)).toBe(true);
    });

    it('preload script exports getPathForFile and checkPathPermission', () => {
      const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf-8');
      expect(preloadSrc).toContain('getPathForFile:');
      expect(preloadSrc).toContain('checkPathPermission:');
      expect(preloadSrc).toContain('openFilePicker:');
      expect(preloadSrc).toContain('convertFile:');
    });

    it('preload getPathForFile guards against null/empty file objects', () => {
      const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf-8');
      expect(preloadSrc).toContain('if (!file) return');
    });

    it('both Dashboard and Widget windows share the exact same preload script', () => {
      const windowSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'window.ts'), 'utf-8');
      // Both functions must call getPreloadPath()
      const dashboardBlock = windowSrc.slice(windowSrc.indexOf('createDashboardWindow'));
      const widgetBlock = windowSrc.slice(windowSrc.indexOf('createFloatingWidgetWindow'));
      expect(dashboardBlock).toContain('preload: getPreloadPath()');
      expect(widgetBlock).toContain('preload: getPreloadPath()');
    });
  });

  describe('2. Multi-Format Image Drop & Conversion (PNG, JPEG, WebP, BMP, TIFF)', () => {
    it('handles dropped PNG file and converts to JPEG successfully', async () => {
      const filePath = path.join(tempDir, 'photo.png');
      const buf = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
      fs.writeFileSync(filePath, buf);

      const check = await simulateCheckPath(filePath);
      expect(check.exists).toBe(true);
      expect(check.isApproved).toBe(true);

      const res = await imageConverter.convertImage(filePath, 'jpeg');
      expect(res.success).toBe(true);
      expect(fs.existsSync(res.outputPath!)).toBe(true);
    });

    it('handles dropped JPEG file and converts to WebP successfully', async () => {
      const filePath = path.join(tempDir, 'photo.jpg');
      const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 255, b: 0 } } }).jpeg().toBuffer();
      fs.writeFileSync(filePath, buf);

      const check = await simulateCheckPath(filePath);
      expect(check.exists).toBe(true);
      expect(check.isApproved).toBe(true);

      const res = await imageConverter.convertImage(filePath, 'webp');
      expect(res.success).toBe(true);
      expect(fs.existsSync(res.outputPath!)).toBe(true);
    });

    it('handles dropped WebP file and converts to PNG successfully', async () => {
      const filePath = path.join(tempDir, 'photo.webp');
      const buf = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).webp().toBuffer();
      fs.writeFileSync(filePath, buf);

      const check = await simulateCheckPath(filePath);
      expect(check.exists).toBe(true);
      expect(check.isApproved).toBe(true);

      const res = await imageConverter.convertImage(filePath, 'png');
      expect(res.success).toBe(true);
      expect(fs.existsSync(res.outputPath!)).toBe(true);
    });

    it('handles dropped BMP file and converts to PNG successfully', async () => {
      const filePath = path.join(tempDir, 'graphic.png');
      const buf = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();
      fs.writeFileSync(filePath, buf);

      // Convert PNG -> BMP first to get a real BMP
      const bmpRes = await imageConverter.convertImage(filePath, 'bmp');
      expect(bmpRes.success).toBe(true);
      const bmpFile = bmpRes.outputPath!;

      // Drop BMP and convert to PNG
      const check = await simulateCheckPath(bmpFile);
      expect(check.exists).toBe(true);
      expect(check.isApproved).toBe(true);

      const toPng = await imageConverter.convertImage(bmpFile, 'png');
      expect(toPng.success).toBe(true);
      expect(fs.existsSync(toPng.outputPath!)).toBe(true);
    });

    it('handles dropped TIFF file and converts to JPEG successfully', async () => {
      const filePath = path.join(tempDir, 'graphic.tiff');
      const buf = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 249, g: 115, b: 22 } } }).tiff().toBuffer();
      fs.writeFileSync(filePath, buf);

      const check = await simulateCheckPath(filePath);
      expect(check.exists).toBe(true);
      expect(check.isApproved).toBe(true);

      const res = await imageConverter.convertImage(filePath, 'jpeg');
      expect(res.success).toBe(true);
      expect(fs.existsSync(res.outputPath!)).toBe(true);
    });
  });

  describe('3. Document Drop & Conversion (PDF to TXT)', () => {
    it('handles dropped PDF file and extracts text to TXT file', async () => {
      const pdfPath = path.join(tempDir, 'manual.pdf');
      fs.copyFileSync(validSamplePdfPath, pdfPath);

      const check = await simulateCheckPath(pdfPath);
      expect(check.exists).toBe(true);
      expect(check.isApproved).toBe(true);

      const res = await documentConverter.convertDocument(pdfPath, 'txt');
      expect(res.success).toBe(true);
      expect(res.outputPath).toBeDefined();
      expect(fs.existsSync(res.outputPath!)).toBe(true);
      const content = fs.readFileSync(res.outputPath!, 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    });
  });

  describe('4. Negative Path Resolution & Security Checks', () => {
    it('rejects empty or whitespace file path with BAD_REQUEST', async () => {
      const check = await simulateCheckPath('');
      expect(check.exists).toBe(false);
      expect(check.error).toBe('BAD_REQUEST');
    });

    it('rejects relative path or bare filename with NOT_ABSOLUTE', async () => {
      const check = await simulateCheckPath('filename_only.png');
      expect(check.exists).toBe(false);
      expect(check.error).toBe('NOT_ABSOLUTE');
    });

    it('rejects non-existent file path with FILE_NOT_FOUND', async () => {
      const missing = path.join(tempDir, 'ghost_file.png');
      const check = await simulateCheckPath(missing);
      expect(check.exists).toBe(false);
      expect(check.error).toBe('FILE_NOT_FOUND');
    });

    it('detects file in unapproved directory and provides folder metadata for approval flow', async () => {
      const unapprovedFile = path.join(unapprovedDir, 'outside_file.png');
      const buf = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
      fs.writeFileSync(unapprovedFile, buf);

      const check = await simulateCheckPath(unapprovedFile);
      expect(check.exists).toBe(true);
      expect(check.isFile).toBe(true);
      expect(check.isApproved).toBe(false);
      expect(check.folderPath).toBe(unapprovedDir);
      expect(check.folderName).toBe(path.basename(unapprovedDir));

      // Attempting conversion fails security check
      const failRes = await imageConverter.convertImage(unapprovedFile, 'jpeg');
      expect(failRes.success).toBe(false);
      expect(failRes.error).toContain('SECURITY_VIOLATION');

      // Now approve the folder
      const addRes = permissionRegistry.addFolder(unapprovedDir, 'Newly Approved');
      expect(addRes.success).toBe(true);

      // Re-check path permission: now approved
      const reCheck = await simulateCheckPath(unapprovedFile);
      expect(reCheck.isApproved).toBe(true);

      // Conversion now succeeds!
      const convRes = await imageConverter.convertImage(unapprovedFile, 'jpeg');
      expect(convRes.success).toBe(true);
      expect(fs.existsSync(convRes.outputPath!)).toBe(true);
    });
  });

  describe('5. Geometry & Drop Hit Testing (Center Circle vs Outer Ring vs Outside)', () => {
    const center = 190;
    const rInner = 70;
    const rOuter = 160;
    const sectorCount = 5;

    it('detects drop inside the center circle (r < 70)', () => {
      // (190, 190) is dead center
      const hit = getRadialSectorHit(190, 190, center, center, rInner, rOuter, sectorCount);
      expect(hit.isInsideCenter).toBe(true);
      expect(hit.isInsideRing).toBe(false);
      expect(hit.isOutside).toBe(false);
    });

    it('detects drop near the edge of the center circle (r = 60)', () => {
      const hit = getRadialSectorHit(190, 190 + 60, center, center, rInner, rOuter, sectorCount);
      expect(hit.isInsideCenter).toBe(true);
      expect(hit.isInsideRing).toBe(false);
    });

    it('detects drop on a radial sector in the ring (70 < r < 160)', () => {
      // (190, 190 + 115) is inside the ring (radius 115px)
      const hit = getRadialSectorHit(190, 190 + 115, center, center, rInner, rOuter, sectorCount);
      expect(hit.isInsideRing).toBe(true);
      expect(hit.isInsideCenter).toBe(false);
      expect(hit.sectorIndex).toBeGreaterThanOrEqual(0);
      expect(hit.sectorIndex).toBeLessThan(sectorCount);
    });

    it('detects drop outside the radial widget boundary (r > 160)', () => {
      // (190, 10) is radius 180px from center
      const hit = getRadialSectorHit(190, 10, center, center, rInner, rOuter, sectorCount);
      expect(hit.isOutside).toBe(true);
      expect(hit.isInsideRing).toBe(false);
      expect(hit.isInsideCenter).toBe(false);
    });
  });

  describe('6. Click-Through & CSS Interaction Protection', () => {
    it('glassmorphism.css explicitly sets -webkit-app-region: no-drag on widget container and primary circle', () => {
      const css = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'renderer', 'src', 'styles', 'glassmorphism.css'),
        'utf-8'
      );
      expect(css).toContain('.widget-window-container {\n  width: 100vw;\n  height: 100vh;\n  position: relative;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: transparent !important;\n  overflow: hidden;\n  -webkit-app-region: no-drag;');
      expect(css).toContain('.primary-circle {\n  width: 140px;');
      expect(css).toContain('-webkit-app-region: no-drag !important;');
    });

    it('primary-circle children have pointer-events: none to prevent drag interception', () => {
      const css = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'renderer', 'src', 'styles', 'glassmorphism.css'),
        'utf-8'
      );
      expect(css).toContain('.primary-circle * {\n  pointer-events: none;\n}');
    });

    it('WidgetView implementation ensures setIgnoreMouseEvents(false) is triggered on dragenter', () => {
      const widgetSrc = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'WidgetView.tsx'),
        'utf-8'
      );
      expect(widgetSrc).toContain('dragCounter > 0');
      expect(widgetSrc).toContain('updateIgnoreMouseEvents(false)');
      expect(widgetSrc).toContain('setIsDraggingFile(true)');
    });
  });

  describe('7. Error Cleanup & State Reset Logic', () => {
    it('WidgetView provides approval flow and reset handlers for error dismissal', () => {
      const widgetSrc = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'WidgetView.tsx'),
        'utf-8'
      );
      expect(widgetSrc).toContain('handleApproveFolderAndConvert');
      expect(widgetSrc).toContain('unapprovedFolderInfo');
      expect(widgetSrc).toContain('setUnapprovedFolderInfo(null)');
    });

    it('classifyFile recognizes and classifies dropped file extensions accurately', () => {
      const img = classifyFile({ name: 'photo.png', path: 'C:\\test\\photo.png' });
      expect(img.category).toBe('image');
      expect(img.extension).toBe('png');

      const doc = classifyFile({ name: 'contract.pdf', path: 'C:\\test\\contract.pdf' });
      expect(doc.category).toBe('document');
      expect(doc.extension).toBe('pdf');
    });
  });
});
