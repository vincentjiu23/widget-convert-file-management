import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runWindowsDnDSmokeTest() {
  console.log('================================================================');
  console.log('   RADIAL FILE STUDIO — WINDOWS DRAG-AND-DROP SMOKE TEST');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(cond, msg) {
    total++;
    if (cond) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      throw new Error(`Smoke Test Assertion Failed: ${msg}`);
    }
  }

  // --- SECTION 1: Packaged Artifacts & Binaries ---
  console.log('--- 1. Packaged Windows Binaries (v0.3.3) ---');
  const releaseDir = path.join(rootDir, 'release');
  const nsisExe = path.join(releaseDir, 'Radial File Studio-Setup-0.3.3.exe');
  const portableExe = path.join(releaseDir, 'Radial File Studio-Portable-0.3.3.exe');
  const unpackedExe = path.join(releaseDir, 'win-unpacked', 'Radial File Studio.exe');
  const asarPath = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar');

  assert(fs.existsSync(nsisExe), `NSIS Setup Installer exists: ${nsisExe}`);
  assert(fs.statSync(nsisExe).size > 50 * 1024 * 1024, `NSIS Installer size is valid (${(fs.statSync(nsisExe).size / (1024 * 1024)).toFixed(2)} MB)`);
  assert(fs.existsSync(portableExe), `Portable Executable exists: ${portableExe}`);
  assert(fs.statSync(portableExe).size > 50 * 1024 * 1024, `Portable Executable size is valid (${(fs.statSync(portableExe).size / (1024 * 1024)).toFixed(2)} MB)`);
  assert(fs.existsSync(unpackedExe), `Unpacked executable exists: ${unpackedExe}`);
  assert(fs.existsSync(asarPath), `Packaged app.asar exists: ${asarPath}`);

  // --- SECTION 2: Preload & Renderer Drag Protection Verification ---
  console.log('\n--- 2. Preload & Security Architecture Audit ---');
  const preloadBundlePath = path.join(rootDir, 'dist-electron', 'preload', 'index.js');
  assert(fs.existsSync(preloadBundlePath), 'Preload bundle exists at dist-electron/preload/index.js');
  const preloadCode = fs.readFileSync(preloadBundlePath, 'utf-8');
  assert(preloadCode.includes('webUtils') && preloadCode.includes('getPathForFile'), 'Preload uses Electron webUtils.getPathForFile(file)');
  assert(preloadCode.includes('checkPathPermission'), 'Preload exposes checkPathPermission API');
  assert(preloadCode.includes('contextBridge') && preloadCode.includes('exposeInMainWorld'), 'Preload securely bridges API via contextBridge');
  assert(!preloadCode.includes('require('), 'Preload does not leak raw require to window');

  // Verify Window Security Config
  const windowSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'window.ts'), 'utf-8');
  assert(windowSource.includes('contextIsolation: true'), 'contextIsolation: true enforced for all windows');
  assert(windowSource.includes('nodeIntegration: false'), 'nodeIntegration: false enforced for all windows');
  assert(windowSource.includes('sandbox: false'), 'sandbox is aligned with preload require needs');

  // Verify CSS Drag Region Safety
  const cssSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'src', 'styles', 'glassmorphism.css'), 'utf-8');
  assert(cssSource.includes('-webkit-app-region: no-drag'), 'CSS explicitly ensures no-drag on widget window and primary circle');
  assert(cssSource.includes('pointer-events: none'), 'CSS disables pointer events on inner circle children so drops land cleanly');

  // --- SECTION 3: Live File Explorer Drag Simulation & Conversion Engine ---
  console.log('\n--- 3. File Explorer Drag Simulation: All Formats & Conversion ---');
  const tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rfs-smoke-approved-')));
  const unapprovedDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rfs-smoke-unapproved-')));
  const dbFile = path.join(tempDir, 'smoke.sqlite');

  const mainModuleUrl = pathToFileURL(path.join(rootDir, 'dist-electron', 'main', 'index.js')).href;
  const { DatabaseService, FolderPermissionRegistry, ImageConverter, DocumentConverter } = await import(mainModuleUrl);

  const db = new DatabaseService(dbFile);
  await db.initialize();
  const permissions = new FolderPermissionRegistry(db);
  permissions.addFolder(tempDir, 'Approved Smoke Directory');

  const imgConverter = new ImageConverter(db, permissions);
  const docConverter = new DocumentConverter(db, permissions);

  // A. PNG drop -> JPEG
  const pngPath = path.join(tempDir, 'drop_test.png');
  await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 150, b: 240, alpha: 1 } } }).png().toFile(pngPath);
  const resPng = await imgConverter.convertImage(pngPath, 'jpeg');
  assert(resPng.success && fs.existsSync(resPng.outputPath), `PNG drop converted to JPEG: ${path.basename(resPng.outputPath)}`);

  // B. JPEG drop -> WebP
  const jpgPath = path.join(tempDir, 'drop_test.jpg');
  await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 240, g: 50, b: 50 } } }).jpeg().toFile(jpgPath);
  const resJpg = await imgConverter.convertImage(jpgPath, 'webp');
  assert(resJpg.success && fs.existsSync(resJpg.outputPath), `JPEG drop converted to WebP: ${path.basename(resJpg.outputPath)}`);

  // C. WebP drop -> PNG
  const webpPath = path.join(tempDir, 'drop_test.webp');
  await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 50, g: 200, b: 50, alpha: 1 } } }).webp().toFile(webpPath);
  const resWebp = await imgConverter.convertImage(webpPath, 'png');
  assert(resWebp.success && fs.existsSync(resWebp.outputPath), `WebP drop converted to PNG: ${path.basename(resWebp.outputPath)}`);

  // D. BMP drop -> PNG
  const bmpPath = path.join(tempDir, 'drop_test.bmp');
  const bmpMod = (await import('bmp-js')).default;
  const bmpRaw = Buffer.alloc(32 * 32 * 4);
  for (let i = 0; i < bmpRaw.length; i += 4) {
    bmpRaw[i] = 255; bmpRaw[i + 1] = 0; bmpRaw[i + 2] = 128; bmpRaw[i + 3] = 255;
  }
  const bmpData = bmpMod.encode({ data: bmpRaw, width: 32, height: 32 });
  fs.writeFileSync(bmpPath, bmpData.data);
  const resBmp = await imgConverter.convertImage(bmpPath, 'png');
  assert(resBmp.success && fs.existsSync(resBmp.outputPath), `BMP drop converted to PNG: ${path.basename(resBmp.outputPath)}`);

  // E. TIFF drop -> JPEG
  const tiffPath = path.join(tempDir, 'drop_test.tiff');
  await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 100, b: 200 } } }).tiff().toFile(tiffPath);
  const resTiff = await imgConverter.convertImage(tiffPath, 'jpeg');
  assert(resTiff.success && fs.existsSync(resTiff.outputPath), `TIFF drop converted to JPEG: ${path.basename(resTiff.outputPath)}`);

  // F. PDF drop -> TXT
  const validPdfPath = path.join(rootDir, 'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf');
  const testPdf = path.join(tempDir, 'document_sample.pdf');
  fs.copyFileSync(validPdfPath, testPdf);
  const resPdf = await docConverter.convertDocument(testPdf, 'txt');
  assert(resPdf.success && fs.existsSync(resPdf.outputPath), `PDF drop converted to TXT: ${path.basename(resPdf.outputPath)}`);
  const txtContent = fs.readFileSync(resPdf.outputPath, 'utf-8');
  assert(txtContent.length > 0, `Extracted TXT has valid text (${txtContent.length} chars)`);

  // --- SECTION 4: Security Containment & In-Widget Folder Authorization ---
  console.log('\n--- 4. Unapproved Directory Containment & Dynamic Authorization ---');
  const unapprovedFile = path.join(unapprovedDir, 'explorer_drag_file.png');
  await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toFile(unapprovedFile);

  // Conversion without permission is blocked
  const unapprovedResult = await imgConverter.convertImage(unapprovedFile, 'jpeg');
  assert(unapprovedResult.success === false, 'Conversion from unapproved directory correctly blocked by security policy');
  assert(unapprovedResult.error.includes('SECURITY_VIOLATION'), 'Clear security error code returned to user');

  // Authorize folder dynamically (emulates user clicking "Approve Folder & Convert" in widget error pill)
  const authRes = permissions.addFolder(unapprovedDir, 'User Approved Folder');
  assert(authRes.success === true, 'Folder dynamically authorized in permission registry');

  // Conversion now succeeds
  const reApprovedResult = await imgConverter.convertImage(unapprovedFile, 'jpeg');
  assert(reApprovedResult.success === true && fs.existsSync(reApprovedResult.outputPath), 'Conversion succeeds after user approval');

  // --- Cleanup ---
  try {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(unapprovedDir, { recursive: true, force: true });
  } catch {}

  console.log('\n================================================================');
  console.log(`WINDOWS DRAG-AND-DROP SMOKE TEST PASSED: ${passed}/${total} TESTS (100%)`);
  console.log('================================================================\n');
}

runWindowsDnDSmokeTest().catch((err) => {
  console.error('\n[WINDOWS DND SMOKE TEST FAILED]:', err);
  process.exit(1);
});
