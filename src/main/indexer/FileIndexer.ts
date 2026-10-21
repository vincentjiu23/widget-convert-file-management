import fs from 'fs';
import path from 'path';
import { DatabaseService, ApprovedFolderRecord, FileIndexRecord } from '../database/DatabaseService';
import { detectFileCategory, extractExtension } from '../../renderer/src/core/FileClassifier';

export interface ScanProgressEvent {
  folderId: string;
  folderPath: string;
  scannedFiles: number;
  currentPath: string;
  isComplete: boolean;
  error?: string;
}

export class FileIndexer {
  private databaseService: DatabaseService;
  private onProgressCallback?: (progress: ScanProgressEvent) => void;
  private isScanningMap: Map<string, boolean> = new Map();
  private cancelledScans: Set<string> = new Set();

  private ignoredDirectoryNames = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '$recycle.bin',
    'system volume information',
    '.cache',
    'appdata'
  ]);

  constructor(
    databaseService: DatabaseService,
    onProgressCallback?: (progress: ScanProgressEvent) => void
  ) {
    this.databaseService = databaseService;
    this.onProgressCallback = onProgressCallback;
  }

  public cancelScan(folderId: string): void {
    if (this.isScanningMap.get(folderId)) {
      this.cancelledScans.add(folderId);
      console.log(`[Indexer] Cancellation requested for folder ${folderId}`);
    }
  }

  public isFolderScanning(folderId: string): boolean {
    return !!this.isScanningMap.get(folderId);
  }

  /**
   * Asynchronous, non-blocking initial scan using cooperative event loop yielding
   */
  public async initialScan(folder: ApprovedFolderRecord, maxDepth = 8): Promise<{ success: boolean; fileCount: number; error?: string }> {
    if (this.isScanningMap.get(folder.id)) {
      return { success: false, fileCount: 0, error: 'Scan already in progress for this folder.' };
    }

    this.isScanningMap.set(folder.id, true);
    this.cancelledScans.delete(folder.id);
    this.databaseService.updateFolderScan(folder.id, 'SCANNING', folder.file_count || 0);

    let totalIndexed = 0;

    try {
      if (!fs.existsSync(folder.path)) {
        this.databaseService.updateFolderScan(folder.id, 'ERROR_NOT_FOUND', 0);
        this.isScanningMap.set(folder.id, false);
        return { success: false, fileCount: 0, error: 'Folder does not exist on disk.' };
      }

      // BFS directory queue for non-blocking asynchronous traversal
      const dirQueue: Array<{ dirPath: string; depth: number }> = [
        { dirPath: folder.path, depth: 0 }
      ];

      const canonicalRoot = path.resolve(folder.path).toLowerCase();

      while (dirQueue.length > 0) {
        // Check for cancellation
        if (this.cancelledScans.has(folder.id)) {
          console.log(`[Indexer] Scan aborted for ${folder.name}`);
          this.databaseService.updateFolderScan(folder.id, 'CANCELLED', totalIndexed);
          this.isScanningMap.set(folder.id, false);
          return { success: false, fileCount: totalIndexed, error: 'SCAN_CANCELLED' };
        }

        const current = dirQueue.shift()!;
        if (current.depth > maxDepth) continue;

        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(current.dirPath, { withFileTypes: true });
        } catch (err: unknown) {
          console.warn(`[Indexer] Could not read directory ${current.dirPath}:`, err);
          continue;
        }

        for (const entry of entries) {
          if (this.cancelledScans.has(folder.id)) break;

          const entryName = entry.name;
          const fullPath = path.join(current.dirPath, entryName);

          if (entry.isDirectory()) {
            if (this.ignoredDirectoryNames.has(entryName.toLowerCase())) {
              continue;
            }

            // Junction / Symlink protection: ensure realpath stays inside root
            try {
              const real = (await fs.promises.realpath(fullPath)).toLowerCase();
              if (real !== canonicalRoot && !real.startsWith(canonicalRoot + path.sep)) {
                console.warn(`[Indexer] Skipping symlink target pointing outside root: ${fullPath} -> ${real}`);
                continue;
              }
            } catch {
              continue;
            }

            dirQueue.push({ dirPath: fullPath, depth: current.depth + 1 });
          } else if (entry.isFile()) {
            try {
              const stat = await fs.promises.stat(fullPath);
              const extension = extractExtension(entryName);
              const category = detectFileCategory(extension);

              const record: FileIndexRecord = {
                id: `fil-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                folder_id: folder.id,
                path: fullPath,
                parent_path: current.dirPath,
                name: entryName,
                extension,
                category,
                size_bytes: stat.size,
                mtime_ms: stat.mtimeMs,
                ctime_ms: stat.ctimeMs,
                indexed_at: Date.now(),
                index_status: 'INDEXED'
              };

              this.databaseService.upsertFileIndex(record);
              totalIndexed++;

              // Periodic progress report and cooperative yield
              if (totalIndexed % 25 === 0) {
                if (this.onProgressCallback) {
                  this.onProgressCallback({
                    folderId: folder.id,
                    folderPath: folder.path,
                    scannedFiles: totalIndexed,
                    currentPath: fullPath,
                    isComplete: false
                  });
                }
                // Yield to event loop to keep Electron UI completely responsive
                await new Promise((resolve) => setImmediate(resolve));
              }
            } catch (fileErr) {
              console.warn(`[Indexer] Skipping inaccessible file ${fullPath}:`, fileErr);
            }
          }
        }

        // Cooperative yield between directories
        await new Promise((resolve) => setImmediate(resolve));
      }

      // Persist to disk BEFORE notifying UI of completion
      this.databaseService.updateFolderScan(folder.id, 'INDEXED', totalIndexed);
      this.databaseService.persistSync();

      this.databaseService.logActivity({
        event_type: 'INITIAL_SCAN_COMPLETED',
        resource_type: 'FOLDER',
        resource_id: folder.id,
        summary: `Scan completed for ${folder.name}: ${totalIndexed} files indexed.`
      });

      if (this.onProgressCallback) {
        this.onProgressCallback({
          folderId: folder.id,
          folderPath: folder.path,
          scannedFiles: totalIndexed,
          currentPath: folder.path,
          isComplete: true
        });
      }

      this.isScanningMap.set(folder.id, false);
      return { success: true, fileCount: totalIndexed };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.databaseService.updateFolderScan(folder.id, 'ERROR', totalIndexed);
      this.isScanningMap.set(folder.id, false);
      return { success: false, fileCount: totalIndexed, error: errorMsg };
    }
  }

  /**
   * Handles incremental events emitted by the native filesystem watcher
   */
  public handleIncrementalEvent(folderId: string, folderRoot: string, eventType: string, relativeOrFileName: string): void {
    const fullPath = path.isAbsolute(relativeOrFileName)
      ? relativeOrFileName
      : path.join(folderRoot, relativeOrFileName);

    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          const name = path.basename(fullPath);
          const extension = extractExtension(name);
          const category = detectFileCategory(extension);

          const record: FileIndexRecord = {
            id: `fil-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            folder_id: folderId,
            path: fullPath,
            parent_path: path.dirname(fullPath),
            name,
            extension,
            category,
            size_bytes: stat.size,
            mtime_ms: stat.mtimeMs,
            ctime_ms: stat.ctimeMs,
            indexed_at: Date.now(),
            index_status: 'INDEXED'
          };

          this.databaseService.upsertFileIndex(record);
        }
      } else {
        // File removed or renamed away
        this.databaseService.removeFileIndex(fullPath);
      }

      const newCount = this.databaseService.getTotalFileCount(folderId);
      this.databaseService.updateFolderScan(folderId, 'INDEXED', newCount);
      this.databaseService.schedulePersist();
    } catch (err) {
      console.error(`[Indexer] Error processing incremental event for ${fullPath}:`, err);
    }
  }

  /**
   * Reconciles index after app restart, wake from sleep, or watcher buffer overflow
   */
  public async reconcileFolder(folder: ApprovedFolderRecord): Promise<{ reconciled: boolean; updatedCount: number }> {
    if (!fs.existsSync(folder.path)) {
      this.databaseService.updateFolderScan(folder.id, 'OFFLINE_OR_DELETED', 0);
      return { reconciled: false, updatedCount: 0 };
    }

    const result = await this.initialScan(folder);
    if (result.success) {
      this.databaseService.updateFolderScan(folder.id, 'RECONCILED', result.fileCount);
    }
    return { reconciled: result.success, updatedCount: result.fileCount };
  }
}
