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

export type WatcherStatus = 'ACTIVE' | 'RECOVERING' | 'FAILED' | 'STOPPED';

export interface WatcherState {
  watcher: fs.FSWatcher | null;
  status: WatcherStatus;
  retryCount: number;
  retryTimer: NodeJS.Timeout | null;
  folderId: string;
}

export class DirectoryWatcherService {
  private watcherStates: Map<string, WatcherState> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private maxRetries = 5;

  constructor(
    private getTargetWindow: () => BrowserWindow | null,
    private permissionRegistry: FolderPermissionRegistry,
    private fileIndexer?: FileIndexer
  ) {}

  public setIndexer(indexer: FileIndexer): void {
    this.fileIndexer = indexer;
  }

  public getWatcherStatus(dirPath: string): WatcherStatus | 'UNWATCHED' {
    const canonical = this.permissionRegistry.canonicalize(dirPath);
    const state = this.watcherStates.get(canonical);
    return state ? state.status : 'UNWATCHED';
  }

  public getRetryCount(dirPath: string): number {
    const canonical = this.permissionRegistry.canonicalize(dirPath);
    const state = this.watcherStates.get(canonical);
    return state ? state.retryCount : 0;
  }

  public watch(dirPath: string, folderId?: string, isRecovery = false): { success: boolean; error?: string } {
    const canonical = this.permissionRegistry.canonicalize(dirPath);

    // Process utama harus memvalidasi bahwa direktori ada di daftar yang disetujui dan aktif
    const perm = this.permissionRegistry.isPathWithinApprovedFolder(canonical);
    if (!perm.isValid || !perm.matchedFolder || !perm.matchedFolder.enabled) {
      console.warn(`[Security Alert] Blocked attempt to watch unapproved or disabled path: ${canonical}`);
      return {
        success: false,
        error: 'PERMISSION_DENIED: Cannot watch a directory outside user-approved and enabled folders.'
      };
    }

    const matchedFolderId = folderId || perm.matchedFolder.id;

    // Check if watcher already active
    const existing = this.watcherStates.get(canonical);
    if (existing && existing.status === 'ACTIVE' && existing.watcher) {
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
        this.handleWatcherError(canonical, matchedFolderId, err);
      });

      // Clear any pending retry timer
      if (existing && existing.retryTimer) {
        clearTimeout(existing.retryTimer);
      }

      this.watcherStates.set(canonical, {
        watcher,
        status: 'ACTIVE',
        retryCount: 0,
        retryTimer: null,
        folderId: matchedFolderId
      });

      console.log(`[Watcher] Native Windows watcher active for: ${canonical}`);

      // If this watch was established following recovery, reconcile the folder to catch missed events
      if (isRecovery && this.fileIndexer && perm.matchedFolder) {
        console.log(`[Watcher] Scheduling index reconciliation after recovery for: ${canonical}`);
        this.fileIndexer.reconcileFolder(perm.matchedFolder).catch((reconcileErr) => {
          console.error(`[Watcher] Recovery reconciliation error for ${canonical}:`, reconcileErr);
        });
      }

      return { success: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Watcher] Failed to start watcher for ${canonical}:`, err);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Handles watcher failure with limited exponential backoff retry.
   * If folder is disabled or removed during backoff, the retry is aborted immediately.
   */
  public handleWatcherError(canonical: string, folderId: string, err?: unknown): void {
    const existing = this.watcherStates.get(canonical);
    if (existing?.watcher) {
      try {
        existing.watcher.close();
      } catch {}
      existing.watcher = null;
    }

    this.clearDebounceTimersForPath(canonical);

    // Verify folder is still approved and enabled before scheduling retry
    const perm = this.permissionRegistry.isPathWithinApprovedFolder(canonical);
    if (!perm.isValid || !perm.matchedFolder || !perm.matchedFolder.enabled) {
      console.log(`[Watcher] Aborting retry for disabled or removed folder: ${canonical}`);
      if (existing?.retryTimer) {
        clearTimeout(existing.retryTimer);
      }
      this.watcherStates.delete(canonical);
      return;
    }

    const currentRetry = (existing?.retryCount || 0) + 1;

    if (currentRetry > this.maxRetries) {
      console.error(`[Watcher] Maximum retries (${this.maxRetries}) exceeded for ${canonical}. Marked as FAILED.`);
      this.watcherStates.set(canonical, {
        watcher: null,
        status: 'FAILED',
        retryCount: currentRetry,
        retryTimer: null,
        folderId
      });
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, max 16s
    const backoffMs = Math.min(1000 * Math.pow(2, currentRetry - 1), 16000);
    console.warn(`[Watcher] Watcher recovering for ${canonical}. Scheduling retry #${currentRetry} in ${backoffMs}ms`);

    const retryTimer = setTimeout(() => {
      // Re-check permissions and enablement when the timer expires
      const recheck = this.permissionRegistry.isPathWithinApprovedFolder(canonical);
      if (!recheck.isValid || !recheck.matchedFolder || !recheck.matchedFolder.enabled) {
        console.log(`[Watcher] Cancelled retry: Folder was disabled or removed during backoff (${canonical})`);
        this.watcherStates.delete(canonical);
        return;
      }

      const res = this.watch(canonical, folderId, true);
      if (!res.success) {
        this.handleWatcherError(canonical, folderId, res.error);
      }
    }, backoffMs);

    this.watcherStates.set(canonical, {
      watcher: null,
      status: 'RECOVERING',
      retryCount: currentRetry,
      retryTimer,
      folderId
    });
  }

  public unwatch(dirPath: string): boolean {
    const canonical = this.permissionRegistry.canonicalize(dirPath);
    const state = this.watcherStates.get(canonical);

    if (state) {
      if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
      }
      if (state.watcher) {
        try {
          state.watcher.close();
        } catch {}
        state.watcher = null;
      }
      state.status = 'STOPPED';
      this.watcherStates.delete(canonical);
      this.clearDebounceTimersForPath(canonical);
      console.log(`[Watcher] Stopped watching and cleared timers for: ${canonical}`);
      return true;
    }

    this.clearDebounceTimersForPath(canonical);
    return false;
  }

  public unwatchAll(): void {
    for (const [pathKey, state] of this.watcherStates.entries()) {
      if (state.retryTimer) {
        clearTimeout(state.retryTimer);
      }
      if (state.watcher) {
        try {
          state.watcher.close();
        } catch (err) {
          console.warn(`[Watcher] Error closing watcher for ${pathKey}:`, err);
        }
      }
    }
    this.watcherStates.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private clearDebounceTimersForPath(canonical: string): void {
    const prefix = `${canonical}:`;
    for (const [key, timer] of this.debounceTimers.entries()) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
  }

  /**
   * For automated testing: manually simulates a watcher error event
   */
  public triggerErrorForTesting(dirPath: string, error?: Error): void {
    const canonical = this.permissionRegistry.canonicalize(dirPath);
    const state = this.watcherStates.get(canonical);
    if (state) {
      this.handleWatcherError(canonical, state.folderId, error || new Error('Simulated Watcher Error'));
    }
  }
}
