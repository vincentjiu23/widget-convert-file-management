import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

const getDirname = (): string => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

export interface ApprovedFolderRecord {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  added_at: number;
  last_scan_at: number | null;
  scan_status: string;
  file_count: number;
}

export interface FileIndexRecord {
  id: string;
  folder_id: string;
  path: string;
  parent_path: string;
  name: string;
  extension: string;
  category: string;
  size_bytes: number;
  mtime_ms: number;
  ctime_ms: number;
  indexed_at: number;
  index_status: string;
  error_message?: string | null;
}

export interface ActivityEventRecord {
  id: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  summary: string;
  timestamp: number;
  details_json?: string;
}

export interface ConversionJobRecord {
  id: string;
  source_path: string;
  source_filename: string;
  input_format: string;
  output_format: string;
  output_path?: string | null;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  duration_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
}

export class DatabaseService {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private dbFilePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(dbFilePath: string) {
    this.dbFilePath = dbFilePath;
  }

  /**
   * Resolves sql-wasm.wasm path across dev, test, and production packaging
   */
  private resolveWasmPath(): string | undefined {
    const currentDir = getDirname();
    const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
    const candidatePaths = [
      path.join(currentDir, 'sql-wasm.wasm'),
      path.join(currentDir, '../sql-wasm.wasm'),
      resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked/node_modules/sql.js/dist/sql-wasm.wasm') : '',
      resourcesPath ? path.join(resourcesPath, 'sql-wasm.wasm') : '',
      path.resolve(currentDir, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
      path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
    ].filter(Boolean);

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return undefined;
  }

  public async initialize(): Promise<void> {
    const wasmPath = this.resolveWasmPath();
    const wasmBinary = wasmPath ? new Uint8Array(fs.readFileSync(wasmPath)).buffer : undefined;

    this.SQL = await initSqlJs({
      wasmBinary
    });

    const dir = path.dirname(this.dbFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbFilePath)) {
      try {
        const buffer = fs.readFileSync(this.dbFilePath);
        this.db = new this.SQL.Database(buffer);
        // Quick integrity check
        this.db.exec('PRAGMA integrity_check;');
        console.log(`[Database] Loaded verified database from ${this.dbFilePath}`);
      } catch (err) {
        console.error(`[Database] Database corruption detected at ${this.dbFilePath}. Creating backup and resetting:`, err);
        try {
          const corruptBackup = `${this.dbFilePath}.corrupt-${Date.now()}`;
          fs.renameSync(this.dbFilePath, corruptBackup);
          console.warn(`[Database] Corrupted database backed up to ${corruptBackup}`);
        } catch (backupErr) {
          console.error(`[Database] Could not rename corrupted database:`, backupErr);
        }
        this.db = new this.SQL.Database();
      }
    } else {
      this.db = new this.SQL.Database();
      console.log(`[Database] Initialized new in-memory SQLite database`);
    }

    this.runMigrations();
    this.persistSync();
  }

  private runMigrations(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER
      );
    `);

    const result = this.db.exec(`SELECT MAX(version) as max_v FROM schema_migrations;`);
    const currentVersion =
      result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]
        ? (result[0].values[0][0] as number)
        : 0;

    if (currentVersion < 1) {
      console.log('[Database] Applying Migration 001_initial_schema');
      this.db.run(`
        CREATE TABLE IF NOT EXISTS selected_folders (
          id TEXT PRIMARY KEY,
          path TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          added_at INTEGER NOT NULL,
          last_scan_at INTEGER,
          scan_status TEXT NOT NULL DEFAULT 'IDLE',
          file_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS file_index_entries (
          id TEXT PRIMARY KEY,
          folder_id TEXT NOT NULL,
          path TEXT UNIQUE NOT NULL,
          parent_path TEXT NOT NULL,
          name TEXT NOT NULL,
          extension TEXT NOT NULL,
          category TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          mtime_ms INTEGER NOT NULL,
          ctime_ms INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL,
          index_status TEXT NOT NULL DEFAULT 'INDEXED',
          error_message TEXT,
          FOREIGN KEY (folder_id) REFERENCES selected_folders (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_files_folder_id ON file_index_entries(folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_category ON file_index_entries(category);
        CREATE INDEX IF NOT EXISTS idx_files_extension ON file_index_entries(extension);

        CREATE TABLE IF NOT EXISTS conversion_jobs (
          id TEXT PRIMARY KEY,
          source_path TEXT NOT NULL,
          source_filename TEXT NOT NULL,
          input_format TEXT NOT NULL,
          output_format TEXT NOT NULL,
          output_path TEXT,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          duration_ms INTEGER,
          error_code TEXT,
          error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS activity_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          details_json TEXT
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        INSERT INTO schema_migrations (version, applied_at) VALUES (1, ${Date.now()});
      `);
    }
  }

  public persistSync(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbFilePath, Buffer.from(data));
    } catch (err) {
      console.error('[Database] Failed to persist SQLite to disk:', err);
    }
  }

  public schedulePersist(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.persistSync();
      this.saveTimeout = null;
    }, 400);
  }

  // --- Folder Management ---

  public getApprovedFolders(): ApprovedFolderRecord[] {
    if (!this.db) return [];
    const res = this.db.exec(`SELECT id, path, name, enabled, added_at, last_scan_at, scan_status, file_count FROM selected_folders;`);
    if (res.length === 0) return [];

    return res[0].values.map((row) => ({
      id: row[0] as string,
      path: row[1] as string,
      name: row[2] as string,
      enabled: (row[3] as number) === 1,
      added_at: row[4] as number,
      last_scan_at: row[5] as number | null,
      scan_status: row[6] as string,
      file_count: row[7] as number
    }));
  }

  public getApprovedFolderById(folderId: string): ApprovedFolderRecord | null {
    if (!this.db) return null;
    const stmt = this.db.prepare(`SELECT id, path, name, enabled, added_at, last_scan_at, scan_status, file_count FROM selected_folders WHERE id = ?;`);
    stmt.bind([folderId]);
    if (stmt.step()) {
      const row = stmt.get();
      const folder: ApprovedFolderRecord = {
        id: row[0] as string,
        path: row[1] as string,
        name: row[2] as string,
        enabled: (row[3] as number) === 1,
        added_at: row[4] as number,
        last_scan_at: row[5] as number | null,
        scan_status: row[6] as string,
        file_count: row[7] as number
      };
      stmt.free();
      return folder;
    }
    stmt.free();
    return null;
  }

  public addApprovedFolder(folder: { id: string; path: string; name: string; enabled: boolean }): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO selected_folders (id, path, name, enabled, added_at, scan_status, file_count)
      VALUES (?, ?, ?, ?, ?, 'IDLE', 0);
    `);
    stmt.run([folder.id, folder.path, folder.name, folder.enabled ? 1 : 0, Date.now()]);
    stmt.free();
    this.schedulePersist();
  }

  public updateFolderScan(folderId: string, status: string, fileCount: number): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      UPDATE selected_folders
      SET scan_status = ?, last_scan_at = ?, file_count = ?
      WHERE id = ?;
    `);
    stmt.run([status, Date.now(), fileCount, folderId]);
    stmt.free();
    this.schedulePersist();
  }

  public toggleFolder(folderId: string, enabled: boolean): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`UPDATE selected_folders SET enabled = ? WHERE id = ?;`);
    stmt.run([enabled ? 1 : 0, folderId]);
    stmt.free();
    this.schedulePersist();
  }

  public removeApprovedFolder(folderId: string): void {
    if (!this.db) return;
    const stmt1 = this.db.prepare(`DELETE FROM file_index_entries WHERE folder_id = ?;`);
    stmt1.run([folderId]);
    stmt1.free();

    const stmt2 = this.db.prepare(`DELETE FROM selected_folders WHERE id = ?;`);
    stmt2.run([folderId]);
    stmt2.free();

    this.schedulePersist();
  }

  // --- File Indexing ---

  public upsertFileIndex(entry: FileIndexRecord): void {
    this.upsertFileIndexBatch([entry]);
  }

  public upsertFileIndexBatch(entries: FileIndexRecord[]): void {
    if (!this.db || entries.length === 0) return;
    this.db.run('BEGIN TRANSACTION;');
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO file_index_entries
        (id, folder_id, path, parent_path, name, extension, category, size_bytes, mtime_ms, ctime_ms, indexed_at, index_status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      for (const entry of entries) {
        stmt.run([
          entry.id,
          entry.folder_id,
          entry.path,
          entry.parent_path,
          entry.name,
          entry.extension,
          entry.category,
          entry.size_bytes,
          entry.mtime_ms,
          entry.ctime_ms,
          entry.indexed_at,
          entry.index_status,
          entry.error_message || null
        ]);
      }
      stmt.free();
      this.db.run('COMMIT;');
    } catch (err) {
      this.db.run('ROLLBACK;');
      console.error('[Database] Failed to batch upsert file index:', err);
    }
    this.schedulePersist();
  }

  public removeFileIndex(filePath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`DELETE FROM file_index_entries WHERE path = ? COLLATE NOCASE;`);
    stmt.run([filePath]);
    stmt.free();
    this.schedulePersist();
  }

  public removeFileIndexOrDirectory(targetPath: string): void {
    if (!this.db || !targetPath) return;
    const cleanPath = targetPath.replace(/[/\\]+$/, '');
    const prefixBackslash = `${cleanPath}\\`;
    const prefixSlash = `${cleanPath}/`;

    // Safe against SQL wildcard interpretation of % and _ in path names,
    // strictly prevents deleting sibling folders with matching prefixes (e.g. C:\Folder vs C:\Folder2),
    // and enforces Windows-consistent case-insensitive path comparison via COLLATE NOCASE.
    const stmt = this.db.prepare(`
      DELETE FROM file_index_entries 
      WHERE path = ? COLLATE NOCASE
         OR SUBSTR(path, 1, ?) = ? COLLATE NOCASE
         OR SUBSTR(path, 1, ?) = ? COLLATE NOCASE;
    `);
    stmt.run([
      cleanPath,
      prefixBackslash.length,
      prefixBackslash,
      prefixSlash.length,
      prefixSlash
    ]);
    stmt.free();
    this.schedulePersist();
  }

  public getExistingFilePathsForFolder(folderId: string): string[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT path FROM file_index_entries WHERE folder_id = ?;`);
    stmt.bind([folderId]);
    const paths: string[] = [];
    while (stmt.step()) {
      paths.push(stmt.get()[0] as string);
    }
    stmt.free();
    return paths;
  }

  /**
   * Safely purges deleted files ONLY within directories that were fully and successfully scanned.
   * Directories skipped due to maxDepth, exclusion lists, or permission errors are NEVER purged.
   * Files whose metadata could not be read (stat failure / lock) are preserved in unverifiedFilePaths.
   */
  public purgeMissingFilesForScannedDirectories(
    folderId: string,
    scannedDirectories: Set<string>,
    validFilePaths: Set<string>,
    unverifiedFilePaths: Set<string> = new Set()
  ): number {
    if (!this.db || scannedDirectories.size === 0) return 0;
    const stmt = this.db.prepare(`SELECT path, parent_path FROM file_index_entries WHERE folder_id = ?;`);
    stmt.bind([folderId]);
    const toDelete: string[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      const filePath = row[0] as string;
      const parentPath = row[1] as string;
      const canonicalParent = path.resolve(parentPath).toLowerCase();
      const canonicalFile = path.resolve(filePath).toLowerCase();

      // Only purge if the containing directory was fully and successfully scanned,
      // AND the file was neither successfully visited nor unverified due to stat error
      if (scannedDirectories.has(canonicalParent)) {
        if (!validFilePaths.has(canonicalFile) && !unverifiedFilePaths.has(canonicalFile)) {
          toDelete.push(filePath);
        }
      }
    }
    stmt.free();

    if (toDelete.length === 0) return 0;

    this.db.run('BEGIN TRANSACTION;');
    try {
      const delStmt = this.db.prepare(`DELETE FROM file_index_entries WHERE folder_id = ? AND path = ?;`);
      for (const p of toDelete) {
        delStmt.run([folderId, p]);
      }
      delStmt.free();
      this.db.run('COMMIT;');
    } catch (err) {
      this.db.run('ROLLBACK;');
      console.error('[Database] Failed to purge missing files for folder:', err);
      return 0;
    }

    const newCount = this.getTotalFileCount(folderId);
    this.schedulePersist();
    return toDelete.length;
  }

  public purgeMissingFilesForFolder(folderId: string, validPaths: Set<string>): number {
    if (!this.db) return 0;
    const existing = this.getExistingFilePathsForFolder(folderId);
    const toDelete = existing.filter((p) => !validPaths.has(p));
    if (toDelete.length === 0) return 0;

    this.db.run('BEGIN TRANSACTION;');
    try {
      const stmt = this.db.prepare(`DELETE FROM file_index_entries WHERE folder_id = ? AND path = ?;`);
      for (const p of toDelete) {
        stmt.run([folderId, p]);
      }
      stmt.free();
      this.db.run('COMMIT;');
    } catch (err) {
      this.db.run('ROLLBACK;');
      console.error('[Database] Failed to purge missing files for folder:', err);
      return 0;
    }

    const newCount = this.getTotalFileCount(folderId);
    this.updateFolderScan(folderId, 'INDEXED', newCount);
    this.schedulePersist();
    return toDelete.length;
  }

  public getFileIndexEntries(folderId?: string, limit = 100, offset = 0, query = ''): FileIndexRecord[] {
    if (!this.db) return [];
    let sql = `SELECT id, folder_id, path, parent_path, name, extension, category, size_bytes, mtime_ms, ctime_ms, indexed_at, index_status, error_message FROM file_index_entries`;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (folderId) {
      conditions.push(`folder_id = ?`);
      params.push(folderId);
    }
    if (query && query.trim() !== '') {
      conditions.push(`(name LIKE ? OR path LIKE ?)`);
      params.push(`%${query.trim()}%`);
      params.push(`%${query.trim()}%`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY mtime_ms DESC LIMIT ? OFFSET ?;`;
    params.push(limit);
    params.push(offset);

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const entries: FileIndexRecord[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      entries.push({
        id: row[0] as string,
        folder_id: row[1] as string,
        path: row[2] as string,
        parent_path: row[3] as string,
        name: row[4] as string,
        extension: row[5] as string,
        category: row[6] as string,
        size_bytes: row[7] as number,
        mtime_ms: row[8] as number,
        ctime_ms: row[9] as number,
        indexed_at: row[10] as number,
        index_status: row[11] as string,
        error_message: (row[12] as string) || null
      });
    }
    stmt.free();
    return entries;
  }

  public getTotalFileCount(folderId?: string): number {
    if (!this.db) return 0;
    const sql = folderId
      ? `SELECT COUNT(*) FROM file_index_entries WHERE folder_id = '${folderId}';`
      : `SELECT COUNT(*) FROM file_index_entries;`;
    const res = this.db.exec(sql);
    if (res.length > 0 && res[0].values.length > 0) {
      return res[0].values[0][0] as number;
    }
    return 0;
  }

  // --- Activity Logging ---

  public logActivity(event: { event_type: string; resource_type: string; resource_id: string; summary: string; details?: Record<string, unknown> }): void {
    if (!this.db) return;
    const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const stmt = this.db.prepare(`
      INSERT INTO activity_events (id, event_type, resource_type, resource_id, summary, timestamp, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run([
      id,
      event.event_type,
      event.resource_type,
      event.resource_id,
      event.summary,
      Date.now(),
      event.details ? JSON.stringify(event.details) : null
    ]);
    stmt.free();
    this.schedulePersist();
  }

  public getActivityLogs(limit = 50): ActivityEventRecord[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT id, event_type, resource_type, resource_id, summary, timestamp, details_json
      FROM activity_events
      ORDER BY timestamp DESC
      LIMIT ?;
    `);
    stmt.bind([limit]);

    const logs: ActivityEventRecord[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      logs.push({
        id: row[0] as string,
        event_type: row[1] as string,
        resource_type: row[2] as string,
        resource_id: row[3] as string,
        summary: row[4] as string,
        timestamp: row[5] as number,
        details_json: (row[6] as string) || undefined
      });
    }
    stmt.free();
    return logs;
  }

  // --- Conversion Jobs ---

  public insertConversionJob(job: ConversionJobRecord): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT INTO conversion_jobs (
        id, source_path, source_filename, input_format, output_format,
        output_path, status, progress, created_at, started_at, completed_at,
        duration_ms, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run([
      job.id,
      job.source_path,
      job.source_filename,
      job.input_format,
      job.output_format,
      job.output_path || null,
      job.status,
      job.progress,
      job.created_at,
      job.started_at || null,
      job.completed_at || null,
      job.duration_ms || null,
      job.error_code || null,
      job.error_message || null
    ]);
    stmt.free();
    this.schedulePersist();
  }

  public updateConversionJob(
    jobId: string,
    updates: Partial<Omit<ConversionJobRecord, 'id'>>
  ): void {
    if (!this.db) return;
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(val === undefined ? null : val);
    }

    if (fields.length === 0) return;
    values.push(jobId);

    const sql = `UPDATE conversion_jobs SET ${fields.join(', ')} WHERE id = ?;`;
    const stmt = this.db.prepare(sql);
    stmt.run(values);
    stmt.free();
    this.schedulePersist();
  }

  public getConversionJobs(limit = 50): ConversionJobRecord[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT id, source_path, source_filename, input_format, output_format,
             output_path, status, progress, created_at, started_at, completed_at,
             duration_ms, error_code, error_message
      FROM conversion_jobs
      ORDER BY created_at DESC
      LIMIT ?;
    `);
    stmt.bind([limit]);
    const jobs: ConversionJobRecord[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      jobs.push({
        id: row[0] as string,
        source_path: row[1] as string,
        source_filename: row[2] as string,
        input_format: row[3] as string,
        output_format: row[4] as string,
        output_path: (row[5] as string) || null,
        status: row[6] as any,
        progress: row[7] as number,
        created_at: row[8] as number,
        started_at: (row[9] as number) || null,
        completed_at: (row[10] as number) || null,
        duration_ms: (row[11] as number) || null,
        error_code: (row[12] as string) || null,
        error_message: (row[13] as string) || null
      });
    }
    stmt.free();
    return jobs;
  }

  public getConversionJobById(jobId: string): ConversionJobRecord | null {
    if (!this.db) return null;
    const stmt = this.db.prepare(`
      SELECT id, source_path, source_filename, input_format, output_format,
             output_path, status, progress, created_at, started_at, completed_at,
             duration_ms, error_code, error_message
      FROM conversion_jobs
      WHERE id = ?;
    `);
    stmt.bind([jobId]);
    if (stmt.step()) {
      const row = stmt.get();
      const job: ConversionJobRecord = {
        id: row[0] as string,
        source_path: row[1] as string,
        source_filename: row[2] as string,
        input_format: row[3] as string,
        output_format: row[4] as string,
        output_path: (row[5] as string) || null,
        status: row[6] as any,
        progress: row[7] as number,
        created_at: row[8] as number,
        started_at: (row[9] as number) || null,
        completed_at: (row[10] as number) || null,
        duration_ms: (row[11] as number) || null,
        error_code: (row[12] as string) || null,
        error_message: (row[13] as string) || null
      };
      stmt.free();
      return job;
    }
    stmt.free();
    return null;
  }

  public close(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.persistSync();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
