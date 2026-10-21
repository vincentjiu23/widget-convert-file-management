import fs from 'fs';
import { BrowserWindow } from 'electron';
import { FolderPermissionRegistry } from './security/FolderPermissionRegistry';
import { FileIndexer } from './indexer/FileIndexer';

export interface WatcherEventPayload {
  folderId: string;
  dirPath: string;
  eventType: string;
  filename: string;
  timestamp: number;
}

export class DirectoryWatcherService {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private getTargetWindow: () => BrowserWindow | null,
    private permissionRegistry: FolderPermissionRegistry,
    private fileIndexer?: FileIndexer
  ) {}

  public setIndexer(indexer: FileIndexer): void {
    this.fileIndexer = indexer;
  }

  public watch(dirPath: string, folderId?: string): { success: boolean; error?: string } {
    const canonical = this.permissionRegistry.canonicalize(dirPath);

    // SECURITY GATE: Process utama harus memvalidasi bahwa direktori ada di daftar yang disetujui
    const perm = this.permissionRegistry.isPathWithinApprovedFolder(canonical);
    if (!perm.isValid || !perm.matchedFolder) {
      console.warn(`[Security Alert] Blocked attempt to watch unapproved path: ${canonical}`);
      return {
        success: false,
        error: 'PERMISSION_DENIED: Cannot watch a directory outside user-approved folders.'
      };
    }

    const matchedFolderId = folderId || perm.matchedFolder.id;

    if (this.watchers.has(canonical)) {
      return { success: true };
    }

    try {
      if (!fs.existsSync(canonical)) {
        return { success: false, error: 'DIRECTORY_NOT_FOUND: Folder does not exist on disk.' };
      }

      // Windows ReadDirectoryChangesW native wrapper
      const watcher = fs.watch(canonical, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Debounce by filename (case-insensitive for Windows) to collapse rapid duplicate rename & change events
        const key = `${canonical}:${filename.toString().toLowerCase()}`;
        if (this.debounceTimers.has(key)) {
          clearTimeout(this.debounceTimers.get(key));
        }

        const timer = setTimeout(() => {
          this.debounceTimers.delete(key);

          // Update SQLite index
          if (this.fileIndexer) {
            this.fileIndexer.handleIncrementalEvent(matchedFolderId, canonical, eventType, filename.toString());
          }

          // Notify renderer
          const win = this.getTargetWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('fs:directory-changed', {
              folderId: matchedFolderId,
              dirPath: canonical,
              eventType,
              filename: filename.toString(),
              timestamp: Date.now()
            });
          }
        }, 150);

        this.debounceTimers.set(key, timer);
      });

      watcher.on('error', (err) => {
        console.error(`[Watcher] Native Windows watcher error for ${canonical}:`, err);
        this.unwatch(canonical);
      });

      this.watchers.set(canonical, watcher);
      console.log(`[Watcher] Native Windows watcher active for: ${canonical}`);
      return { success: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Watcher] Failed to start watcher for ${canonical}:`, err);
      return { success: false, error: errorMsg };
    }
  }

  public unwatch(dirPath: string): boolean {
    const canonical = this.permissionRegistry.canonicalize(dirPath);
    const watcher = this.watchers.get(canonical);
    if (watcher) {
      watcher.close();
      this.watchers.delete(canonical);
      console.log(`[Watcher] Stopped watching: ${canonical}`);
      return true;
    }
    return false;
  }

  public unwatchAll(): void {
    for (const [pathKey, watcher] of this.watchers.entries()) {
      try {
        watcher.close();
      } catch (err) {
        console.warn(`[Watcher] Error closing watcher for ${pathKey}:`, err);
      }
    }
    this.watchers.clear();
  }
}
