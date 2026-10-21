import fs from 'fs';
import { BrowserWindow } from 'electron';

export class DirectoryWatcherService {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private getTargetWindow: () => BrowserWindow | null) {}

  public watch(dirPath: string): boolean {
    if (this.watchers.has(dirPath)) {
      return true;
    }

    try {
      if (!fs.existsSync(dirPath)) {
        console.warn(`[Watcher] Directory does not exist: ${dirPath}`);
        return false;
      }

      // fs.watch with recursive: true on Windows natively maps to ReadDirectoryChangesW
      const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const key = `${dirPath}:${filename}:${eventType}`;
        if (this.debounceTimers.has(key)) {
          clearTimeout(this.debounceTimers.get(key));
        }

        const timer = setTimeout(() => {
          this.debounceTimers.delete(key);
          const win = this.getTargetWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('fs:directory-changed', {
              dirPath,
              eventType,
              filename: filename.toString(),
              timestamp: Date.now()
            });
          }
        }, 150);

        this.debounceTimers.set(key, timer);
      });

      watcher.on('error', (err) => {
        console.error(`[Watcher] Error watching ${dirPath}:`, err);
        this.unwatch(dirPath);
      });

      this.watchers.set(dirPath, watcher);
      console.log(`[Watcher] Native Windows watcher active for: ${dirPath}`);
      return true;
    } catch (err) {
      console.error(`[Watcher] Failed to watch ${dirPath}:`, err);
      return false;
    }
  }

  public unwatch(dirPath: string): boolean {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
      console.log(`[Watcher] Stopped watching: ${dirPath}`);
      return true;
    }
    return false;
  }

  public unwatchAll(): void {
    for (const [path, watcher] of this.watchers.entries()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
