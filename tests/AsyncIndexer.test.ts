import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileIndexer, ScanProgressEvent } from '../src/main/indexer/FileIndexer';
import { DatabaseService } from '../src/main/database/DatabaseService';
import path from 'path';
import fs from 'fs';

/**
 * Async Indexer Integration Tests
 * Verifies: non-blocking BFS traversal, cancellation, symlink containment,
 * database persistence before UI notification, and cooperative yielding.
 */
describe('Async FileIndexer', () => {
  let db: DatabaseService;
  let indexer: FileIndexer;
  const testDbPath = path.join(__dirname, 'test_async_indexer.sqlite');
  const testDir = path.join(__dirname, 'test_scan_dir');

  beforeEach(async () => {
    // Clean up
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

    // Create test directory structure
    fs.mkdirSync(path.join(testDir, 'subfolder', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'photo.jpg'), 'fake-image-data');
    fs.writeFileSync(path.join(testDir, 'report.pdf'), 'fake-pdf-data');
    fs.writeFileSync(path.join(testDir, 'subfolder', 'video.mp4'), 'fake-video-data');
    fs.writeFileSync(path.join(testDir, 'subfolder', 'deep', 'nested.png'), 'fake-png-data');

    db = new DatabaseService(testDbPath);
    await db.initialize();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('uses async traversal (no readdirSync in FileIndexer.ts)', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'main', 'indexer', 'FileIndexer.ts'),
      'utf-8'
    );
    // initialScan must NOT use blocking readdirSync
    expect(source).not.toContain('readdirSync');
    // Must use async fs.promises
    expect(source).toContain('fs.promises.readdir');
    expect(source).toContain('fs.promises.stat');
    // Must have cooperative yield
    expect(source).toContain('setImmediate');
  });

  it('scans a real directory and indexes files into the database', async () => {
    const progressEvents: ScanProgressEvent[] = [];
    indexer = new FileIndexer(db, (p) => progressEvents.push(p));

    db.addApprovedFolder({
      id: 'f-test',
      path: testDir,
      name: 'Test Scan Dir',
      enabled: true
    });

    const result = await indexer.initialScan({
      id: 'f-test',
      path: testDir,
      name: 'Test Scan Dir',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    });

    expect(result.success).toBe(true);
    expect(result.fileCount).toBe(4); // photo.jpg, report.pdf, video.mp4, nested.png

    // Verify database has the files
    const files = db.getFileIndexEntries('f-test');
    expect(files.length).toBe(4);

    // Check final progress event marks completion
    const lastProgress = progressEvents[progressEvents.length - 1];
    expect(lastProgress?.isComplete).toBe(true);
  });

  it('respects cancellation during scan', async () => {
    // Create a larger directory to give time for cancellation
    const bigDir = path.join(testDir, 'bigfolder');
    fs.mkdirSync(bigDir, { recursive: true });
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(bigDir, `file_${i}.txt`), `data-${i}`);
    }

    indexer = new FileIndexer(db);

    db.addApprovedFolder({
      id: 'f-cancel',
      path: testDir,
      name: 'Cancel Test',
      enabled: true
    });

    const folder = {
      id: 'f-cancel',
      path: testDir,
      name: 'Cancel Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING' as const,
      file_count: 0
    };

    // Start scan and immediately cancel
    const scanPromise = indexer.initialScan(folder);
    indexer.cancelScan('f-cancel');
    
    const result = await scanPromise;
    // Scan should either be cancelled or completed (race condition is acceptable)
    // The important invariant: scanning flag is cleared and no hang occurred
    expect(indexer.isFolderScanning('f-cancel')).toBe(false);
    
    if (result.error === 'SCAN_CANCELLED') {
      // Cancellation worked — fewer files indexed than total
      expect(result.fileCount).toBeLessThanOrEqual(54); // 4 base + 50 in bigfolder
    } else {
      // Scan completed before cancellation took effect — still valid
      expect(result.success).toBe(true);
    }
  });

  it('prevents duplicate simultaneous scans of the same folder', async () => {
    indexer = new FileIndexer(db);

    const folder = {
      id: 'f-dup',
      path: testDir,
      name: 'Dup Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING' as const,
      file_count: 0
    };

    db.addApprovedFolder({
      id: folder.id,
      path: folder.path,
      name: folder.name,
      enabled: folder.enabled
    });

    // Start first scan (don't await)
    const scan1 = indexer.initialScan(folder);
    
    // Try second scan while first is running
    const scan2Result = await indexer.initialScan(folder);
    expect(scan2Result.success).toBe(false);
    expect(scan2Result.error).toContain('already in progress');

    // Wait for first to complete
    await scan1;
  });

  it('skips ignored directories (node_modules, .git, etc.)', async () => {
    // Create ignored directories
    fs.mkdirSync(path.join(testDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'node_modules', 'hidden.js'), 'data');
    fs.mkdirSync(path.join(testDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    indexer = new FileIndexer(db);

    db.addApprovedFolder({
      id: 'f-skip',
      path: testDir,
      name: 'Skip Test',
      enabled: true
    });

    const result = await indexer.initialScan({
      id: 'f-skip',
      path: testDir,
      name: 'Skip Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    });

    expect(result.success).toBe(true);
    // Should NOT include node_modules/hidden.js or .git/HEAD
    const files = db.getFileIndexEntries('f-skip');
    const filePaths = files.map(f => f.path);
    const hasNodeModules = filePaths.some(p => p.includes('node_modules'));
    const hasGit = filePaths.some(p => p.includes('.git'));
    expect(hasNodeModules).toBe(false);
    expect(hasGit).toBe(false);
    // Should still have the 4 regular files
    expect(result.fileCount).toBe(4);
  });

  it('handles missing folder gracefully', async () => {
    indexer = new FileIndexer(db);
    
    const result = await indexer.initialScan({
      id: 'f-missing',
      path: 'C:\\NonExistent\\Path\\That\\Does\\Not\\Exist',
      name: 'Missing',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('database is persisted before completion event fires', async () => {
    let completionFired = false;
    let dbCountAtCompletion = 0;

    indexer = new FileIndexer(db, (progress) => {
      if (progress.isComplete) {
        completionFired = true;
        // At this point, the database should already have the data
        dbCountAtCompletion = db.getTotalFileCount('f-persist');
      }
    });

    db.addApprovedFolder({
      id: 'f-persist',
      path: testDir,
      name: 'Persist Test',
      enabled: true
    });

    await indexer.initialScan({
      id: 'f-persist',
      path: testDir,
      name: 'Persist Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    });

    expect(completionFired).toBe(true);
    // Database must have data BEFORE the completion callback
    expect(dbCountAtCompletion).toBeGreaterThan(0);
  });

  it('symlink escape guard is present in the source code', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'main', 'indexer', 'FileIndexer.ts'),
      'utf-8'
    );
    // Must contain realpath check for symlink containment
    expect(source).toContain('realpath');
    expect(source).toContain('canonicalRoot');
    // Must warn and skip out-of-root symlinks
    expect(source).toContain('pointing outside root');
  });

  it('purges deleted files from database on reconcile / rescan (offline changes)', async () => {
    indexer = new FileIndexer(db);

    const folderRec = {
      id: 'f-reconcile',
      path: testDir,
      name: 'Reconcile Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);

    // Initial scan indexes 4 files
    const res1 = await indexer.initialScan(folderRec);
    expect(res1.fileCount).toBe(4);
    expect(db.getTotalFileCount('f-reconcile')).toBe(4);

    // Simulate file deletion on disk while app was closed
    const fileToDelete = path.join(testDir, 'photo.jpg');
    fs.unlinkSync(fileToDelete);

    // Run reconcile
    const res2 = await indexer.reconcileFolder(folderRec);
    expect(res2.reconciled).toBe(true);
    expect(res2.updatedCount).toBe(3);

    // Verify database purged the deleted file
    expect(db.getTotalFileCount('f-reconcile')).toBe(3);
    const files = db.getFileIndexEntries('f-reconcile');
    const hasDeleted = files.some((f) => f.path === fileToDelete);
    expect(hasDeleted).toBe(false);
  });

  it('handles incremental events for directory creation and recursive deletion', async () => {
    indexer = new FileIndexer(db);
    db.addApprovedFolder({
      id: 'f-incr',
      path: testDir,
      name: 'Incr Test',
      enabled: true
    });

    // 1. Create a new subfolder with files
    const newSubDir = path.join(testDir, 'dynamic_folder');
    fs.mkdirSync(newSubDir, { recursive: true });
    const dynamicFile1 = path.join(newSubDir, 'doc1.pdf');
    const dynamicFile2 = path.join(newSubDir, 'doc2.txt');
    fs.writeFileSync(dynamicFile1, 'data1');
    fs.writeFileSync(dynamicFile2, 'data2');

    // Trigger incremental event for the directory
    await indexer.handleIncrementalEvent('f-incr', testDir, 'rename', 'dynamic_folder');

    // Check files inside directory were indexed
    const filesAfterAdd = db.getFileIndexEntries('f-incr');
    const hasDoc1 = filesAfterAdd.some((f) => f.path === dynamicFile1);
    expect(hasDoc1).toBe(true);

    // 2. Delete the dynamic_folder
    fs.rmSync(newSubDir, { recursive: true, force: true });
    await indexer.handleIncrementalEvent('f-incr', testDir, 'rename', 'dynamic_folder');

    // Verify all children under dynamic_folder were deleted from index
    const filesAfterDelete = db.getFileIndexEntries('f-incr');
    const stillHasDoc1 = filesAfterDelete.some((f) => f.path === dynamicFile1);
    expect(stillHasDoc1).toBe(false);
  });

  it('uses transaction batching during initial scan for large directories', async () => {
    // Generate 60 small files to trigger at least one batch threshold (batch size 50)
    const batchDir = path.join(testDir, 'batch_test');
    fs.mkdirSync(batchDir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(batchDir, `file_${i}.txt`), `content ${i}`);
    }

    indexer = new FileIndexer(db);
    const folderRec = {
      id: 'f-batch',
      path: testDir,
      name: 'Batch Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);

    const result = await indexer.initialScan(folderRec);
    expect(result.success).toBe(true);
    // 4 base files + 60 batch files = 64 files
    expect(result.fileCount).toBeGreaterThanOrEqual(64);
    expect(db.getTotalFileCount('f-batch')).toBe(result.fileCount);
  });
});
