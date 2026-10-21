import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFloatingWidgetWindow } from './window';
import { DirectoryWatcherService } from './watcher';
import { setupIpcHandlers } from './ipc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let watcherService: DirectoryWatcherService | null = null;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    mainWindow = createFloatingWidgetWindow();
    watcherService = new DirectoryWatcherService(() => mainWindow);

    setupIpcHandlers(() => mainWindow, watcherService);

    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createFloatingWidgetWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (watcherService) {
      watcherService.unwatchAll();
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
