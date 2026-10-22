import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createDashboardWindow, createFloatingWidgetWindow } from './window';
import { DirectoryWatcherService } from './watcher';
import { setupIpcHandlers, WindowControllers } from './ipc';
import { DatabaseService } from './database/DatabaseService';
import { FolderPermissionRegistry } from './security/FolderPermissionRegistry';
import { FileIndexer } from './indexer/FileIndexer';
import { ImageConverter } from './converter/ImageConverter';
import { DocumentConverter } from './converter/DocumentConverter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dashboardWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let databaseService: DatabaseService | null = null;
let permissionRegistry: FolderPermissionRegistry | null = null;
let watcherService: DirectoryWatcherService | null = null;
let fileIndexer: FileIndexer | null = null;
let imageConverter: ImageConverter | null = null;
let documentConverter: DocumentConverter | null = null;

let widgetMoveDebounce: NodeJS.Timeout | null = null;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.focus();
    } else {
      openDashboard();
    }
  });

  function getBaseRendererUrl(mode: 'dashboard' | 'widget'): string {
    if (process.env.VITE_DEV_SERVER_URL) {
      const url = new URL(process.env.VITE_DEV_SERVER_URL);
      url.searchParams.set('mode', mode);
      return url.toString();
    }
    const htmlPath = path.join(__dirname, '../../dist/index.html');
    const fileUrl = pathToFileURL(htmlPath);
    fileUrl.searchParams.set('mode', mode);
    return fileUrl.toString();
  }

  function openDashboard(): BrowserWindow {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.show();
      dashboardWindow.focus();
      return dashboardWindow;
    }

    dashboardWindow = createDashboardWindow();
    dashboardWindow.loadURL(getBaseRendererUrl('dashboard'));

    dashboardWindow.on('closed', () => {
      dashboardWindow = null;
      // If widget is closed too, quit the app
      if (!widgetWindow || widgetWindow.isDestroyed()) {
        app.quit();
      }
    });

    return dashboardWindow;
  }

  function setupWidget(): BrowserWindow {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      return widgetWindow;
    }

    const savedBounds = databaseService?.getSetting<{ x: number; y: number; width: number; height: number } | null>(
      'widget_position',
      null
    );
    const alwaysOnTop = databaseService?.getSetting<boolean>('widget_always_on_top', false) ?? false;

    widgetWindow = createFloatingWidgetWindow(savedBounds || undefined, alwaysOnTop);
    widgetWindow.loadURL(getBaseRendererUrl('widget'));

    // Debounced widget position persistence
    widgetWindow.on('moved', () => {
      if (!widgetWindow || widgetWindow.isDestroyed()) return;
      if (widgetMoveDebounce) clearTimeout(widgetMoveDebounce);
      widgetMoveDebounce = setTimeout(() => {
        if (!widgetWindow || widgetWindow.isDestroyed()) return;
        const bounds = widgetWindow.getBounds();
        databaseService?.setSetting('widget_position', {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        });
      }, 500);
    });

    widgetWindow.on('closed', () => {
      widgetWindow = null;
      if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        app.quit();
      }
    });

    return widgetWindow;
  }

  function toggleWidget(visible?: boolean): boolean {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      setupWidget();
      return true;
    }

    const target = visible !== undefined ? visible : !widgetWindow.isVisible();
    if (target) {
      widgetWindow.show();
    } else {
      widgetWindow.hide();
    }
    return target;
  }

  app.whenReady().then(async () => {
    // 1. Initialize SQLite Database in user data directory
    const dbPath = path.join(app.getPath('userData'), 'radial_studio.sqlite');
    databaseService = new DatabaseService(dbPath);
    await databaseService.initialize();

    // 2. Initialize Authoritative Security Registry & Indexer
    permissionRegistry = new FolderPermissionRegistry(databaseService);
    fileIndexer = new FileIndexer(databaseService, (progress) => {
      const wins = [dashboardWindow, widgetWindow];
      for (const w of wins) {
        if (w && !w.isDestroyed()) {
          w.webContents.send('indexer:progress', progress);
        }
      }
    });

    // 3. Initialize Real Conversion Engines (Sharp for Images, pdf-parse for Documents)
    imageConverter = new ImageConverter(databaseService, permissionRegistry);
    documentConverter = new DocumentConverter(databaseService, permissionRegistry);

    // 4. Initialize Native Windows Watcher
    watcherService = new DirectoryWatcherService(
      () => dashboardWindow || widgetWindow,
      permissionRegistry,
      fileIndexer
    );

    // 5. Setup Window Controllers and IPC Handlers
    const windowControllers: WindowControllers = {
      getDashboardWindow: () => dashboardWindow,
      getWidgetWindow: () => widgetWindow,
      openDashboardWindow: openDashboard,
      toggleWidgetWindow: toggleWidget
    };

    setupIpcHandlers(
      windowControllers,
      permissionRegistry,
      watcherService,
      fileIndexer,
      databaseService,
      imageConverter,
      documentConverter
    );

    // 6. Restore active watchers for enabled approved folders and reconcile offline changes
    const approvedFolders = permissionRegistry.getApprovedFolders();
    for (const folder of approvedFolders) {
      if (folder.enabled) {
        watcherService.watch(folder.path, folder.id);
        fileIndexer.reconcileFolder(folder).catch((err) => {
          console.warn(`[Startup] Background reconciliation failed for ${folder.name}:`, err);
        });
      }
    }

    // 7. Launch Dashboard Window as primary interface
    openDashboard();

    // 8. Launch Widget Window (compact, draggable)
    setupWidget();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openDashboard();
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
