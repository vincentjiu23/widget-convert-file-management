import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService } from '../src/main/database/DatabaseService';
import path from 'path';
import fs from 'fs';

describe('Part B: Safe Database Record Deletion Suite', () => {
  let db: DatabaseService;
  const testDbPath = path.join(__dirname, 'test_safe_deletion.sqlite');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new DatabaseService(testDbPath);
    await db.initialize();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('safely deletes directories containing % and _ without wildcard misinterpretation', () => {
    db.addApprovedFolder({
      id: 'f-test',
      path: 'C:\\Users\\User\\Projects',
      name: 'Projects',
      enabled: true
    });

    // 1. Target directory with % and _
    const targetDir = 'C:\\Users\\User\\Projects\\100%_Final_Review';
    const targetFile1 = path.join(targetDir, 'summary.pdf');
    const targetFile2 = path.join(targetDir, 'sub', 'budget.xlsx');

    // 2. Sibling directory that would match '_' as wildcard in naive SQL LIKE (e.g. 100X instead of 100%)
    const wildcardUnderScoreDir = 'C:\\Users\\User\\Projects\\100X_Final_Review';
    const wildcardFile = path.join(wildcardUnderScoreDir, 'report.pdf');

    // 3. Sibling directory that would match '%' as wildcard in naive SQL LIKE (e.g. 1000000% instead of 100%)
    const wildcardPercentDir = 'C:\\Users\\User\\Projects\\1000000_Final_Review';
    const wildcardPercentFile = path.join(wildcardPercentDir, 'notes.txt');

    // 4. Sibling directory with identical prefix (prefix collision risk)
    const collisionDir = 'C:\\Users\\User\\Projects\\100%_Final_Review_Extra';
    const collisionFile = path.join(collisionDir, 'extra.txt');

    // Insert all entries
    db.upsertFileIndexBatch([
      {
        id: 'fil-1',
        folder_id: 'f-test',
        path: targetFile1,
        parent_path: targetDir,
        name: 'summary.pdf',
        extension: 'pdf',
        category: 'document',
        size_bytes: 1024,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      },
      {
        id: 'fil-2',
        folder_id: 'f-test',
        path: targetFile2,
        parent_path: path.join(targetDir, 'sub'),
        name: 'budget.xlsx',
        extension: 'xlsx',
        category: 'document',
        size_bytes: 2048,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      },
      {
        id: 'fil-3',
        folder_id: 'f-test',
        path: wildcardFile,
        parent_path: wildcardUnderScoreDir,
        name: 'report.pdf',
        extension: 'pdf',
        category: 'document',
        size_bytes: 512,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      },
      {
        id: 'fil-4',
        folder_id: 'f-test',
        path: wildcardPercentFile,
        parent_path: wildcardPercentDir,
        name: 'notes.txt',
        extension: 'txt',
        category: 'document',
        size_bytes: 256,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      },
      {
        id: 'fil-5',
        folder_id: 'f-test',
        path: collisionFile,
        parent_path: collisionDir,
        name: 'extra.txt',
        extension: 'txt',
        category: 'document',
        size_bytes: 128,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      }
    ]);

    expect(db.getTotalFileCount('f-test')).toBe(5);

    // Act: Delete the target directory containing % and _
    db.removeFileIndexOrDirectory(targetDir);

    const remaining = db.getFileIndexEntries('f-test');
    const remainingPaths = remaining.map((r) => r.path);

    // Assert: Target directory files MUST be deleted
    expect(remainingPaths).not.toContain(targetFile1);
    expect(remainingPaths).not.toContain(targetFile2);

    // Assert: Sibling directories with _ or % or prefix collisions MUST NOT be deleted!
    expect(remainingPaths).toContain(wildcardFile);
    expect(remainingPaths).toContain(wildcardPercentFile);
    expect(remainingPaths).toContain(collisionFile);

    expect(remaining.length).toBe(3);
  });

  it('deletes directory and files case-insensitively on Windows (COLLATE NOCASE)', () => {
    const mixedCaseDir = 'C:\\ProjectFiles\\MixedCaseFolder';
    const file1 = 'C:\\ProjectFiles\\MixedCaseFolder\\Doc.txt';
    const file2 = 'C:\\ProjectFiles\\MixedCaseFolder\\Nested\\Data.bin';

    db.upsertFileIndexBatch([
      {
        id: 'fil-case-1',
        folder_id: 'f-test',
        path: file1,
        parent_path: mixedCaseDir,
        name: 'Doc.txt',
        extension: 'txt',
        category: 'document',
        size_bytes: 100,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      },
      {
        id: 'fil-case-2',
        folder_id: 'f-test',
        path: file2,
        parent_path: `${mixedCaseDir}\\Nested`,
        name: 'Data.bin',
        extension: 'bin',
        category: 'other',
        size_bytes: 200,
        mtime_ms: Date.now(),
        ctime_ms: Date.now(),
        indexed_at: Date.now(),
        index_status: 'INDEXED'
      }
    ]);

    expect(db.getTotalFileCount('f-test')).toBe(2);

    // Call remove with all-lowercase path
    db.removeFileIndexOrDirectory('c:\\projectfiles\\mixedcasefolder');

    const remaining = db.getFileIndexEntries('f-test');
    expect(remaining.length).toBe(0);
  });
});
