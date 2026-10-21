import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { FolderPermissionRegistry } from './security/FolderPermissionRegistry';
import { DirectoryWatcherService } from './watcher';
import { FileIndexer } from './indexer/FileIndexer';
import { DatabaseService } from './database/DatabaseService';

export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  permissionRegistry: FolderPermissionRegistry,
  watcherService: DirectoryWatcherService,
  fileIndexer: FileIndexer,
  databaseService: DatabaseService
): void {
  /**
   * Validate that the IPC event originates from the app's trusted main window.
   * Rejects renderer frames from devtools, secondary windows, or spoofed senders.
   */
  function verifyIpcSender(event: Electron.IpcMainInvokeEvent): boolean {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    try {
      return event.sender === win.webContents;
    } catch {
      return false;
    }
  }

  // --- Folder Management & Security ---

  ipcMain.handle('folders:getApproved', async () => {
    return permissionRegistry.getApprovedFolders();
  });

  ipcMain.handle('folders:add', async (event, rawPath: string, name?: string) => {
    if (!verifyIpcSender(event)) {
      return { success: false, error: 'UNAUTHORIZED: Invalid IPC sender' };
    }
    if (typeof rawPath !== 'string') {
      return { success: false, error: 'BAD_REQUEST: Path must be a string' };
    }

    const result = permissionRegistry.addFolder(rawPath, name);
    if (result.success && result.folder) {
      // Start watcher and trigger initial scan
      watcherService.watch(result.folder.path, result.folder.id);
      fileIndexer.initialScan(result.folder).catch((err) => {
        console.error('[IPC] Initial scan error:', err);
      });
    }
    return result;
  });

  ipcMain.handle('folders:remove', async (event, folderId: string) => {
    if (!verifyIpcSender(event)) return false;
    if (typeof folderId !== 'string') return false;
    const folders = permissionRegistry.getApprovedFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (folder) {
      watcherService.unwatch(folder.path);
    }
    return permissionRegistry.removeFolder(folderId);
  });

  ipcMain.handle('folders:toggle', async (event, folderId: string, enabled: boolean) => {
    if (!verifyIpcSender(event)) return false;
    if (typeof folderId !== 'string' || typeof enabled !== 'boolean') return false;
    const folders = permissionRegistry.getApprovedFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return false;

    permissionRegistry.toggleFolder(folderId, enabled);
    if (enabled) {
      watcherService.watch(folder.path, folder.id);
    } else {
      watcherService.unwatch(folder.path);
    }
    return true;
  });

  ipcMain.handle('folders:rescan', async (event, folderId: string) => {
    if (!verifyIpcSender(event)) return { success: false, error: 'UNAUTHORIZED' };
    if (typeof folderId !== 'string') return { success: false, error: 'BAD_REQUEST' };
    const folders = permissionRegistry.getApprovedFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return { success: false, error: 'FOLDER_NOT_FOUND' };

    const res = await fileIndexer.reconcileFolder(folder);
    return { success: res.reconciled, fileCount: res.updatedCount };
  });

  // --- File Index Queries ---

  ipcMain.handle('index:query', async (_event, folderId?: string, limit = 100, offset = 0, query = '') => {
    return databaseService.getFileIndexEntries(folderId, limit, offset, query);
  });

  ipcMain.handle('index:stats', async () => {
    const totalFiles = databaseService.getTotalFileCount();
    const folders = permissionRegistry.getApprovedFolders();
    return {
      totalFiles,
      approvedFolderCount: folders.length,
      activeWatchersCount: folders.filter((f) => f.enabled).length
    };
  });

  ipcMain.handle('activity:getLogs', async (_event, limit = 50) => {
    return databaseService.getActivityLogs(limit);
  });

  // --- Native Windows Dialogs ---

  ipcMain.handle('dialog:openDirectory', async () => {
    const win = getMainWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'dontAddToRecent'],
      title: 'Select Folder to Approve and Index'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // --- Safe File Operations with Path Containment Validation ---

  ipcMain.handle('shell:openPath', async (event, targetPath: string) => {
    if (!verifyIpcSender(event)) return false;
    if (!targetPath || typeof targetPath !== 'string') return false;

    // Validate path containment
    const validation = permissionRegistry.isPathWithinApprovedFolder(targetPath);
    if (!validation.isValid) {
      console.warn(`[Security Alert] Blocked attempt to open file outside approved scope: ${targetPath}`);
      return false;
    }

    const res = await shell.openPath(validation.canonicalPath);
    return res === '';
  });

  ipcMain.handle('shell:showItemInFolder', async (event, targetPath: string) => {
    if (!verifyIpcSender(event)) return false;
    if (!targetPath || typeof targetPath !== 'string') return false;

    const validation = permissionRegistry.isPathWithinApprovedFolder(targetPath);
    if (!validation.isValid) {
      console.warn(`[Security Alert] Blocked attempt to reveal file outside approved scope: ${targetPath}`);
      return false;
    }

    shell.showItemInFolder(validation.canonicalPath);
    return true;
  });

  // --- Window Control ---

  ipcMain.on('window:setIgnoreMouseEvents', (_event, ignore: boolean, forward?: boolean) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: !!forward });
    }
  });

  ipcMain.on('window:minimize', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  ipcMain.on('window:close', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
}
