import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirectoryWatcherService } from '../src/main/watcher';
import { FileIndexer } from '../src/main/indexer/FileIndexer';
import { FolderPermissionRegistry } from '../src/main/security/FolderPermissionRegistry';
import { DatabaseService } from '../src/main/database/DatabaseService';
import path from 'path';
import fs from 'fs';

describe('Part A & C: Final Index Integrity and Watcher Recovery Suite', () => {
  let db: DatabaseService;
  let registry: FolderPermissionRegistry;
  let watcherService: DirectoryWatcherService;
  let indexer: FileIndexer;

  const testDbPath = path.join(__dirname, 'test_integrity.sqlite');
  const testDir = path.join(__dirname, 'test_integrity_dir');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

    fs.mkdirSync(testDir, { recursive: true });

    db = new DatabaseService(testDbPath);
    await db.initialize();
    registry = new FolderPermissionRegistry(db);

    indexer = new FileIndexer(db);
    watcherService = new DirectoryWatcherService(
      () => null,
      registry,
      indexer
    );
    watcherService.setIndexer(indexer);
  });

  afterEach(() => {
    try {
      watcherService.unwatchAll();
      db.close();
    } catch {}
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // --- Part A: FileIndexer Reconciliation & Partial Scan Integrity ---

  it('retains database records for subdirectories beyond maxDepth', async () => {
    // Structure:
    // testDir/file_level0.txt
    // testDir/level1/file_level1.txt
    // testDir/level1/level2/file_level2.txt
    const lvl1 = path.join(testDir, 'level1');
    const lvl2 = path.join(lvl1, 'level2');
    fs.mkdirSync(lvl2, { recursive: true });

    const f0 = path.join(testDir, 'file_level0.txt');
    const f1 = path.join(lvl1, 'file_level1.txt');
    const f2 = path.join(lvl2, 'file_level2.txt');

    fs.writeFileSync(f0, 'data0');
    fs.writeFileSync(f1, 'data1');
    fs.writeFileSync(f2, 'data2');

    const folderRec = {
      id: 'f-depth',
      path: testDir,
      name: 'Depth Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);
    registry.refreshCache();

    // Step 1: Scan with full depth (maxDepth = 5) -> all 3 files indexed
    const fullScan = await indexer.initialScan(folderRec, 5);
    expect(fullScan.fileCount).toBe(3);
    expect(db.getTotalFileCount('f-depth')).toBe(3);

    // Step 2: Now re-scan with maxDepth = 0 (only root directory, lvl1 and lvl2 skipped!)
    const shallowScan = await indexer.initialScan(folderRec, 0);
    expect(shallowScan.isPartial).toBe(true);
    expect(shallowScan.scanStatus).toBe('PARTIAL_INDEXED');
    expect(shallowScan.success).toBe(false);

    // Verify folder status in database is PARTIAL_INDEXED, NOT INDEXED
    const updatedFolder = db.getApprovedFolderById('f-depth');
    expect(updatedFolder?.scan_status).toBe('PARTIAL_INDEXED');

    // Verify: Records for level1 and level2 MUST BE RETAINED, NOT purged!
    const allFiles = db.getFileIndexEntries('f-depth');
    const paths = allFiles.map((f) => f.path);
    expect(paths).toContain(f0);
    expect(paths).toContain(f1);
    expect(paths).toContain(f2);
    expect(allFiles.length).toBe(3);
  });

  it('retains records when a file stat() fails and reports PARTIAL_INDEXED status without purging the file', async () => {
    const f1 = path.join(testDir, 'accessible.txt');
    const fLocked = path.join(testDir, 'locked.txt');
    fs.writeFileSync(f1, 'accessible content');
    fs.writeFileSync(fLocked, 'locked content');

    const folderRec = {
      id: 'f-stat-err',
      path: testDir,
      name: 'Stat Error Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);
    registry.refreshCache();

    // Initial full scan: both files successfully indexed
    const initialScan = await indexer.initialScan(folderRec);
    expect(initialScan.success).toBe(true);
    expect(initialScan.scanStatus).toBe('INDEXED');
    expect(db.getTotalFileCount('f-stat-err')).toBe(2);

    // Now simulate fs.promises.stat failing on locked.txt (e.g. EACCES or file lock)
    const originalStat = fs.promises.stat;
    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation((async (filePath: any, opts: any) => {
      if (typeof filePath === 'string' && filePath.includes('locked.txt')) {
        const err = new Error('EACCES: permission denied') as any;
        err.code = 'EACCES';
        throw err;
      }
      return (originalStat as any)(filePath, opts);
    }) as any);

    try {
      const res = await indexer.initialScan(folderRec);
      expect(res.success).toBe(false);
      expect(res.isPartial).toBe(true);
      expect(res.scanStatus).toBe('PARTIAL_INDEXED');

      // Verify folder status in database is PARTIAL_INDEXED, NOT INDEXED
      const updatedFolder = db.getApprovedFolderById('f-stat-err');
      expect(updatedFolder?.scan_status).toBe('PARTIAL_INDEXED');

      // Verify the locked file's existing record is RETAINED, NOT purged!
      const files = db.getFileIndexEntries('f-stat-err');
      const paths = files.map((f) => f.path);
      expect(paths).toContain(fLocked);
      expect(paths).toContain(f1);
      expect(files.length).toBe(2);
    } finally {
      statSpy.mockRestore();
    }
  });

  it('retains records when a subdirectory fails to read and reports PARTIAL_INDEXED status', async () => {
    const accessibleDir = path.join(testDir, 'accessible');
    const brokenDir = path.join(testDir, 'broken');
    fs.mkdirSync(accessibleDir);
    fs.mkdirSync(brokenDir);

    const fGood = path.join(accessibleDir, 'good.txt');
    const fBroken = path.join(brokenDir, 'unreadable.txt');
    fs.writeFileSync(fGood, 'good');
    fs.writeFileSync(fBroken, 'broken');

    const folderRec = {
      id: 'f-partial',
      path: testDir,
      name: 'Partial Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);
    registry.refreshCache();

    // Initial full scan
    await indexer.initialScan(folderRec);
    expect(db.getTotalFileCount('f-partial')).toBe(2);

    // Mock fs.promises.readdir to simulate failure on brokenDir
    const originalReaddir = fs.promises.readdir;
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockImplementation((async (dirPath: any, opts: any) => {
      if (typeof dirPath === 'string' && dirPath.includes('broken')) {
        const err = new Error('EACCES: permission denied') as any;
        err.code = 'EACCES';
        throw err;
      }
      return (originalReaddir as any)(dirPath, opts);
    }) as any);

    try {
      const res = await indexer.initialScan(folderRec);
      expect(res.success).toBe(false);
      expect(res.isPartial).toBe(true);
      expect(res.scanStatus).toBe('PARTIAL_INDEXED');

      // Verify folder status in database is NOT 'INDEXED'
      const updatedFolder = db.getApprovedFolderById('f-partial');
      expect(updatedFolder?.scan_status).toBe('PARTIAL_INDEXED');

      // Verify file in unreadable directory is KEPT, not purged
      const files = db.getFileIndexEntries('f-partial');
      const paths = files.map((f) => f.path);
      expect(paths).toContain(fBroken);
      expect(paths).toContain(fGood);
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it('retains records when directory realpath() verification fails and reports PARTIAL_INDEXED', async () => {
    const subDir = path.join(testDir, 'sub_protected');
    fs.mkdirSync(subDir, { recursive: true });
    const fInside = path.join(subDir, 'inside.txt');
    const fRoot = path.join(testDir, 'root_file.txt');
    fs.writeFileSync(fInside, 'inside content');
    fs.writeFileSync(fRoot, 'root content');

    const folderRec = {
      id: 'f-realpath-err',
      path: testDir,
      name: 'Realpath Error Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);
    registry.refreshCache();

    // Initial full scan: all files indexed successfully
    const initialScan = await indexer.initialScan(folderRec);
    expect(initialScan.success).toBe(true);
    expect(initialScan.scanStatus).toBe('INDEXED');
    expect(db.getTotalFileCount('f-realpath-err')).toBe(2);

    // Now mock fs.promises.realpath to fail specifically when verifying sub_protected directory
    const originalRealpath = fs.promises.realpath;
    const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation((async (dirPath: any, opts: any) => {
      if (typeof dirPath === 'string' && dirPath.includes('sub_protected')) {
        const err = new Error('EACCES: permission denied during realpath resolution') as any;
        err.code = 'EACCES';
        throw err;
      }
      return (originalRealpath as any)(dirPath, opts);
    }) as any);

    try {
      const res = await indexer.initialScan(folderRec);
      expect(res.success).toBe(false);
      expect(res.isPartial).toBe(true);
      expect(res.scanStatus).toBe('PARTIAL_INDEXED');

      // Verify folder status in database is PARTIAL_INDEXED, NOT INDEXED
      const updatedFolder = db.getApprovedFolderById('f-realpath-err');
      expect(updatedFolder?.scan_status).toBe('PARTIAL_INDEXED');

      // Verify that pre-existing files in the unverified directory are RETAINED, NOT purged!
      const files = db.getFileIndexEntries('f-realpath-err');
      const paths = files.map((f) => f.path);
      expect(paths).toContain(fInside);
      expect(paths).toContain(fRoot);
      expect(files.length).toBe(2);
    } finally {
      realpathSpy.mockRestore();
    }
  });

  it('does not follow symlink or junction pointing outside approved root', async () => {
    const subDir = path.join(testDir, 'symlink_dir');
    fs.mkdirSync(subDir, { recursive: true });
    const fInside = path.join(subDir, 'sub_file.txt');
    fs.writeFileSync(fInside, 'sub file');

    const folderRec = {
      id: 'f-symlink-out',
      path: testDir,
      name: 'Symlink Escape Test',
      enabled: true,
      added_at: Date.now(),
      last_scan_at: null,
      scan_status: 'PENDING',
      file_count: 0
    };
    db.addApprovedFolder(folderRec);
    registry.refreshCache();

    // Mock realpath to return a path outside testDir for symlink_dir
    const originalRealpath = fs.promises.realpath;
    const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation((async (dirPath: any, opts: any) => {
      if (typeof dirPath === 'string' && dirPath.includes('symlink_dir')) {
        return path.resolve('C:\\OutsideRoot\\EscapeTarget');
      }
      return (originalRealpath as any)(dirPath, opts);
    }) as any);

    try {
      const res = await indexer.initialScan(folderRec);
      // Out of root directory was skipped, files inside it were NOT indexed!
      const files = db.getFileIndexEntries('f-symlink-out');
      const paths = files.map((f) => f.path);
      expect(paths).not.toContain(fInside);
    } finally {
      realpathSpy.mockRestore();
    }
  });

  // --- Part C: Watcher Recovery, Retries, and Disablement ---

  it('transitions watcher to RECOVERING and schedules exponential retry on error', async () => {
    db.addApprovedFolder({
      id: 'f-watch-err',
      path: testDir,
      name: 'Watch Error Test',
      enabled: true
    });
    registry.refreshCache();

    // Start watching
    const watchRes = watcherService.watch(testDir, 'f-watch-err');
    expect(watchRes.success).toBe(true);
    expect(watcherService.getWatcherStatus(testDir)).toBe('ACTIVE');

    // Simulate native watcher error
    watcherService.triggerErrorForTesting(testDir, new Error('Simulated ReadDirectoryChangesW buffer overflow'));

    // Status should be RECOVERING with retryCount = 1
    expect(watcherService.getWatcherStatus(testDir)).toBe('RECOVERING');
    expect(watcherService.getRetryCount(testDir)).toBe(1);
  });

  it('aborts watcher retry and clears timers when folder is unwatched or disabled', async () => {
    db.addApprovedFolder({
      id: 'f-watch-abort',
      path: testDir,
      name: 'Watch Abort Test',
      enabled: true
    });
    registry.refreshCache();

    watcherService.watch(testDir, 'f-watch-abort');
    expect(watcherService.getWatcherStatus(testDir)).toBe('ACTIVE');

    // Trigger error to put it into RECOVERING with active retryTimer
    watcherService.triggerErrorForTesting(testDir);
    expect(watcherService.getWatcherStatus(testDir)).toBe('RECOVERING');

    // User un-watches (or disables/removes folder)
    const unwatchRes = watcherService.unwatch(testDir);
    expect(unwatchRes).toBe(true);

    // Watcher should be STOPPED/UNWATCHED and pending timers cleared
    expect(watcherService.getWatcherStatus(testDir)).toBe('UNWATCHED');
  });

  it('aborts watcher retry if folder is disabled in registry before retry timer fires', async () => {
    db.addApprovedFolder({
      id: 'f-watch-disable',
      path: testDir,
      name: 'Watch Disable Test',
      enabled: true
    });
    registry.refreshCache();

    watcherService.watch(testDir, 'f-watch-disable');

    // Disable the folder in registry
    registry.toggleFolder('f-watch-disable', false);

    // Trigger error
    watcherService.triggerErrorForTesting(testDir);

    // Because folder is now disabled in registry, handleWatcherError should abort retry immediately
    expect(watcherService.getWatcherStatus(testDir)).toBe('UNWATCHED');
  });
});
