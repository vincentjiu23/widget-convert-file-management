import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFloatingWidgetWindow } from './window';
import { DirectoryWatcherService } from './watcher';
import { setupIpcHandlers } from './ipc';
import { DatabaseService } from './database/DatabaseService';
import { FolderPermissionRegistry } from './security/FolderPermissionRegistry';
import { FileIndexer } from './indexer/FileIndexer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let databaseService: DatabaseService | null = null;
let permissionRegistry: FolderPermissionRegistry | null = null;
let watcherService: DirectoryWatcherService | null = null;
let fileIndexer: FileIndexer | null = null;

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

  app.whenReady().then(async () => {
    mainWindow = createFloatingWidgetWindow();

    // Initialize SQLite Database in user data directory
    const dbPath = path.join(app.getPath('userData'), 'radial_studio.sqlite');
    databaseService = new DatabaseService(dbPath);
    await databaseService.initialize();

    // Initialize Authoritative Security Registry & Indexer
    permissionRegistry = new FolderPermissionRegistry(databaseService);
    fileIndexer = new FileIndexer(databaseService, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('indexer:progress', progress);
      }
    });

    // Initialize Native Windows Watcher
    watcherService = new DirectoryWatcherService(
      () => mainWindow,
      permissionRegistry,
      fileIndexer
    );

    // Setup Secured IPC Handlers
    setupIpcHandlers(
      () => mainWindow,
      permissionRegistry,
      watcherService,
      fileIndexer,
      databaseService
    );

    // Automatically restore active watchers for enabled approved folders and reconcile offline changes
    const approvedFolders = permissionRegistry.getApprovedFolders();
    for (const folder of approvedFolders) {
      if (folder.enabled) {
        watcherService.watch(folder.path, folder.id);
        fileIndexer.reconcileFolder(folder).catch((err) => {
          console.warn(`[Startup] Background reconciliation failed for ${folder.name}:`, err);
        });
      }
    }

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
    if (databaseService) {
      databaseService.close();
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
