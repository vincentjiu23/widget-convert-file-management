import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { DirectoryWatcherService } from './watcher';

export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  watcherService: DirectoryWatcherService
): void {
  // Safe directory picker using native Windows dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const win = getMainWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'dontAddToRecent'],
      title: 'Select Folder to Monitor and Index'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Safe file open / reveal
  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return false;
    const res = await shell.openPath(targetPath);
    return res === ''; // empty string means success in Electron shell.openPath
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return false;
    shell.showItemInFolder(targetPath);
    return true;
  });

  // Watcher registration
  ipcMain.handle('watcher:start', async (_event, dirPath: string) => {
    return watcherService.watch(dirPath);
  });

  ipcMain.handle('watcher:stop', async (_event, dirPath: string) => {
    return watcherService.unwatch(dirPath);
  });

  // Window control
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
