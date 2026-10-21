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

  // Folders to ignore during scanning
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

  /**
   * Performs an initial recursive scan of an approved folder, storing metadata in SQLite
   */
  public async initialScan(folder: ApprovedFolderRecord, maxDepth = 8): Promise<{ success: boolean; fileCount: number; error?: string }> {
    if (this.isScanningMap.get(folder.id)) {
      return { success: false, fileCount: 0, error: 'Scan already in progress for this folder.' };
    }

    this.isScanningMap.set(folder.id, true);
    this.databaseService.updateFolderScan(folder.id, 'SCANNING', folder.file_count || 0);

    let totalIndexed = 0;

    try {
      if (!fs.existsSync(folder.path)) {
        this.databaseService.updateFolderScan(folder.id, 'ERROR_NOT_FOUND', 0);
        this.isScanningMap.set(folder.id, false);
        return { success: false, fileCount: 0, error: 'Folder does not exist on disk.' };
      }

      const scanDirectory = (currentDir: string, currentDepth: number) => {
        if (currentDepth > maxDepth) return;

        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (err: unknown) {
          console.warn(`[Indexer] Could not read directory ${currentDir}:`, err);
          return;
        }

        for (const entry of entries) {
          const entryName = entry.name;
          const fullPath = path.join(currentDir, entryName);

          if (entry.isDirectory()) {
            if (this.ignoredDirectoryNames.has(entryName.toLowerCase())) {
              continue;
            }
            // Check symlink loop/escape
            try {
              const real = fs.realpathSync(fullPath);
              if (!real.startsWith(folder.path)) {
                console.warn(`[Indexer] Skipping symlink target pointing outside root: ${fullPath} -> ${real}`);
                continue;
              }
            } catch {
              continue;
            }

            scanDirectory(fullPath, currentDepth + 1);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              const extension = extractExtension(entryName);
              const category = detectFileCategory(extension);

              const record: FileIndexRecord = {
                id: `fil-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                folder_id: folder.id,
                path: fullPath,
                parent_path: currentDir,
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

              if (totalIndexed % 25 === 0 && this.onProgressCallback) {
                this.onProgressCallback({
                  folderId: folder.id,
                  folderPath: folder.path,
                  scannedFiles: totalIndexed,
                  currentPath: fullPath,
                  isComplete: false
                });
              }
            } catch (fileErr) {
              console.warn(`[Indexer] Skipping inaccessible file ${fullPath}:`, fileErr);
            }
          }
        }
      };

      scanDirectory(folder.path, 0);

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

      // Update total file count for folder
      const newCount = this.databaseService.getTotalFileCount(folderId);
      this.databaseService.updateFolderScan(folderId, 'INDEXED', newCount);
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

    // Run a fast incremental sweep
    const result = await this.initialScan(folder);
    if (result.success) {
      this.databaseService.updateFolderScan(folder.id, 'RECONCILED', result.fileCount);
    }
    return { reconciled: result.success, updatedCount: result.fileCount };
  }
}
