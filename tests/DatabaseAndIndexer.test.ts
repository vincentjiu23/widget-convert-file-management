import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, FileIndexRecord } from '../src/main/database/DatabaseService';
import path from 'path';
import fs from 'fs';

describe('Task D: SQLite Database & Indexing Storage Suite', () => {
  let db: DatabaseService;
  const testDbFile = path.join(__dirname, 'test_radial_index.sqlite');

  beforeEach(async () => {
    if (fs.existsSync(testDbFile)) {
      fs.unlinkSync(testDbFile);
    }
    db = new DatabaseService(testDbFile);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbFile)) {
      try {
        fs.unlinkSync(testDbFile);
      } catch {
        // file handle release
      }
    }
  });

  it('initializes schema and registers migration version 1', () => {
    const folders = db.getApprovedFolders();
    expect(folders).toEqual([]);
    expect(db.getTotalFileCount()).toBe(0);
  });

  it('manages approved folders lifecycle in SQLite', () => {
    db.addApprovedFolder({
      id: 'f-1',
      path: 'C:\\Users\\User\\Desktop',
      name: 'Desktop',
      enabled: true
    });

    const folders = db.getApprovedFolders();
    expect(folders.length).toBe(1);
    expect(folders[0].name).toBe('Desktop');
    expect(folders[0].enabled).toBe(true);

    // Toggle folder
    db.toggleFolder('f-1', false);
    const toggled = db.getApprovedFolders();
    expect(toggled[0].enabled).toBe(false);

    // Update scan stats
    db.updateFolderScan('f-1', 'INDEXED', 42);
    const updated = db.getApprovedFolders();
    expect(updated[0].scan_status).toBe('INDEXED');
    expect(updated[0].file_count).toBe(42);
  });

  it('indexes files and supports filtered queries and search', () => {
    db.addApprovedFolder({
      id: 'f-docs',
      path: 'C:\\Users\\User\\Documents',
      name: 'Documents',
      enabled: true
    });

    const file1: FileIndexRecord = {
      id: 'fil-1',
      folder_id: 'f-docs',
      path: 'C:\\Users\\User\\Documents\\Financial_Q1.pdf',
      parent_path: 'C:\\Users\\User\\Documents',
      name: 'Financial_Q1.pdf',
      extension: 'pdf',
      category: 'document',
      size_bytes: 1048576,
      mtime_ms: 1700000000000,
      ctime_ms: 1690000000000,
      indexed_at: Date.now(),
      index_status: 'INDEXED'
    };

    const file2: FileIndexRecord = {
      id: 'fil-2',
      folder_id: 'f-docs',
      path: 'C:\\Users\\User\\Documents\\Team_Photo.png',
      parent_path: 'C:\\Users\\User\\Documents',
      name: 'Team_Photo.png',
      extension: 'png',
      category: 'image',
      size_bytes: 2048576,
      mtime_ms: 1705000000000,
      ctime_ms: 1695000000000,
      indexed_at: Date.now(),
      index_status: 'INDEXED'
    };

    db.upsertFileIndex(file1);
    db.upsertFileIndex(file2);

    expect(db.getTotalFileCount()).toBe(2);

    // Query all
    const allFiles = db.getFileIndexEntries();
    expect(allFiles.length).toBe(2);

    // Search query
    const searchRes = db.getFileIndexEntries(undefined, 10, 0, 'Financial');
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].name).toBe('Financial_Q1.pdf');

    // Remove file (incremental delete)
    db.removeFileIndex(file1.path);
    expect(db.getTotalFileCount()).toBe(1);
    const remaining = db.getFileIndexEntries();
    expect(remaining[0].name).toBe('Team_Photo.png');
  });

  it('persists and retrieves activity logs', () => {
    db.logActivity({
      event_type: 'INITIAL_SCAN',
      resource_type: 'FOLDER',
      resource_id: 'f-1',
      summary: 'Indexed 120 files in Desktop'
    });

    const logs = db.getActivityLogs(10);
    expect(logs.length).toBe(1);
    expect(logs[0].event_type).toBe('INITIAL_SCAN');
    expect(logs[0].summary).toContain('120 files');
  });
});
