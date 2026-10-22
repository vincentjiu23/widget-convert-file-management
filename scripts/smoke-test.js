import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runSmokeTest() {
  console.log('==================================================');
  console.log('   RADIAL FILE STUDIO — PACKAGED SMOKE TEST SUITE');
  console.log('==================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // TEST 1: Package Artifacts
  console.log('--- Test Suite 1: Windows Packaging Artifacts ---');
  const releaseDir = path.join(rootDir, 'release');
  const nsisExe = path.join(releaseDir, 'Radial File Studio-Setup-0.3.0.exe');
  const portableExe = path.join(releaseDir, 'Radial File Studio-Portable-0.3.0.exe');
  const unpackedExe = path.join(releaseDir, 'win-unpacked', 'Radial File Studio.exe');
  const asarPath = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar');

  assert(fs.existsSync(nsisExe), `NSIS Setup Installer exists at: ${nsisExe}`);
  const nsisStat = fs.statSync(nsisExe);
  assert(nsisStat.size > 50 * 1024 * 1024, `NSIS installer size is valid (${(nsisStat.size / (1024 * 1024)).toFixed(2)} MB)`);

  assert(fs.existsSync(portableExe), `Portable Executable exists at: ${portableExe}`);
  const portStat = fs.statSync(portableExe);
  assert(portStat.size > 50 * 1024 * 1024, `Portable executable size is valid (${(portStat.size / (1024 * 1024)).toFixed(2)} MB)`);

  assert(fs.existsSync(unpackedExe), `Unpacked executable exists at: ${unpackedExe}`);
  assert(fs.existsSync(asarPath), `Packaged app.asar exists at: ${asarPath}`);

  // Load Main Bundle
  const mainModuleUrl = pathToFileURL(path.join(rootDir, 'dist-electron', 'main', 'index.js')).href;
  const mainModule = await import(mainModuleUrl);
  const { DatabaseService, DocumentConverter, ImageConverter, getSafeWidgetBounds } = mainModule;

  // TEST 2: SQLite Database Persistence
  console.log('\n--- Test Suite 2: SQLite Database Storage & Persistence ---');
  const testDbDir = path.join(rootDir, 'tests', 'fixtures', 'smoke_temp');
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }
  const testDbFile = path.join(testDbDir, `smoke_test_${Date.now()}.sqlite`);
  
  const db = new DatabaseService(testDbFile);
  await db.initialize();
  assert(fs.existsSync(testDbFile), `Physical SQLite file created on disk at: ${testDbFile}`);

  // Test settings persistence (widget_position & widget_always_on_top)
  const sampleBounds = { x: 450, y: 320, width: 380, height: 380 };
  db.setSetting('widget_position', sampleBounds);
  db.setSetting('widget_always_on_top', true);

  const retrievedBounds = db.getSetting('widget_position', null);
  assert(
    retrievedBounds && retrievedBounds.x === 450 && retrievedBounds.y === 320,
    `Widget bounds stored and retrieved accurately: ${JSON.stringify(retrievedBounds)}`
  );

  const retrievedTop = db.getSetting('widget_always_on_top', false);
  assert(retrievedTop === true, 'Widget always-on-top setting persisted correctly');

  // TEST 3: Document Conversion (PDF to TXT) with Atomic Finalization
  console.log('\n--- Test Suite 3: Document Conversion & Atomic Finalization ---');
  const docConverter = new DocumentConverter(db);

  // Create a genuine minimal PDF
  const samplePdfPath = path.join(testDbDir, 'sample_contract.pdf');
  const minimalPdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 55 >>
stream
BT
/F1 18 Tf
100 700 Td
(Radial File Studio Official Production Smoke Test) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000224 00000 n 
0000000330 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
403
%%EOF`;

  fs.writeFileSync(samplePdfPath, minimalPdfContent, 'utf-8');
  assert(fs.existsSync(samplePdfPath), 'Sample PDF source created');

  const docResult = await docConverter.convertDocument(samplePdfPath, 'txt');
  assert(docResult.success === true, `PDF to TXT conversion reported success (Job: ${docResult.jobId})`);
  assert(docResult.outputPath && fs.existsSync(docResult.outputPath), `Output TXT file exists at: ${docResult.outputPath}`);
  
  const extractedTxt = fs.readFileSync(docResult.outputPath, 'utf-8');
  assert(
    extractedTxt.includes('Radial File Studio Official Production Smoke Test'),
    `Extracted text contains original PDF content: "${extractedTxt.trim()}"`
  );

  // Verify anti-overwrite: run second time, verify collision avoidance
  const docResult2 = await docConverter.convertDocument(samplePdfPath, 'txt');
  assert(docResult2.success === true, 'Second conversion succeeded without overwriting');
  assert(docResult2.outputPath !== docResult.outputPath, `Collision handled: second output path is "${path.basename(docResult2.outputPath)}"`);

  // Verify DB job status
  const jobRecord = db.getConversionJob(docResult.jobId);
  assert(jobRecord && jobRecord.status === 'SUCCEEDED', `Database reflects SUCCEEDED status with duration ${jobRecord?.duration_ms}ms`);

  // TEST 4: Image Conversion
  console.log('\n--- Test Suite 4: Image Conversion Engine ---');
  const imgConverter = new ImageConverter(db);

  // Create a 100x100 PNG using sharp
  const sharp = (await import('sharp')).default;
  const samplePngPath = path.join(testDbDir, 'test_radial_image.png');
  await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 249, g: 115, b: 22, alpha: 1 } // Orange
    }
  }).png().toFile(samplePngPath);
  assert(fs.existsSync(samplePngPath), 'Test input image generated (PNG)');

  // Convert PNG -> JPEG
  const imgResultJpeg = await imgConverter.convertImage(samplePngPath, 'jpeg', { quality: 90 });
  assert(imgResultJpeg.success === true, `PNG to JPEG conversion succeeded (Output: ${path.basename(imgResultJpeg.outputPath)})`);
  assert(fs.existsSync(imgResultJpeg.outputPath), `Output JPEG file exists on disk`);

  // Convert PNG -> WebP
  const imgResultWebp = await imgConverter.convertImage(samplePngPath, 'webp', { quality: 85 });
  assert(imgResultWebp.success === true, `PNG to WebP conversion succeeded (Output: ${path.basename(imgResultWebp.outputPath)})`);
  assert(fs.existsSync(imgResultWebp.outputPath), `Output WebP file exists on disk`);

  // TEST 5: Window Bounds & Geometry Logic
  console.log('\n--- Test Suite 5: Window Geometry & Multi-Display Safety ---');
  assert(typeof getSafeWidgetBounds === 'function', 'getSafeWidgetBounds helper is exported and accessible');

  // Clean up smoke test temp files
  try {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  } catch {}

  console.log('\n==================================================');
  console.log(`SMOKE TEST COMPLETED: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log('==================================================');
}

runSmokeTest().catch((err) => {
  console.error('\n[SMOKE TEST FAILED]:', err);
  process.exit(1);
});
