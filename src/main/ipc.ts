import fs from 'fs';
import path from 'path';
import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { FolderPermissionRegistry } from './security/FolderPermissionRegistry';
import { DirectoryWatcherService } from './watcher';
import { FileIndexer } from './indexer/FileIndexer';
import { DatabaseService } from './database/DatabaseService';
import { ImageConverter, ImageConversionOptions } from './converter/ImageConverter';

/**
 * Validate that an IPC event originates strictly from the app's trusted main window.
 * Rejects renderer frames from devtools, secondary windows, external protocols, or spoofed senders.
 */
export function isTrustedIpcSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  win: BrowserWindow | null
): boolean {
  if (!win || win.isDestroyed()) return false;
  try {
    if (event.sender !== win.webContents) return false;
    // If senderFrame is present, verify that it matches the main frame
    if ((event as Electron.IpcMainInvokeEvent).senderFrame && win.webContents.mainFrame) {
      if ((event as Electron.IpcMainInvokeEvent).senderFrame !== win.webContents.mainFrame) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  permissionRegistry: FolderPermissionRegistry,
  watcherService: DirectoryWatcherService,
  fileIndexer: FileIndexer,
  databaseService: DatabaseService,
  imageConverter: ImageConverter
): void {
  function verifyIpcSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
    return isTrustedIpcSender(event, getMainWindow());
  }

  // --- Folder Management & Security ---

  ipcMain.handle('folders:getApproved', async (event) => {
    if (!verifyIpcSender(event)) return [];
    return permissionRegistry.getApprovedFolders();
  });

  ipcMain.handle('folders:add', async (event, rawPath: unknown, name?: unknown) => {
    if (!verifyIpcSender(event)) {
      return { success: false, error: 'UNAUTHORIZED: Invalid IPC sender' };
    }
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { success: false, error: 'BAD_REQUEST: Path must be a non-empty string' };
    }
    const folderName = typeof name === 'string' && name.trim() ? name.trim() : undefined;

    const result = permissionRegistry.addFolder(rawPath.trim(), folderName);
    if (result.success && result.folder) {
      // Start watcher and trigger initial scan
      watcherService.watch(result.folder.path, result.folder.id);
      fileIndexer.initialScan(result.folder).catch((err) => {
        console.error('[IPC] Initial scan error:', err);
      });
    }
    return result;
  });

  ipcMain.handle('folders:remove', async (event, folderId: unknown) => {
    if (!verifyIpcSender(event)) return false;
    if (typeof folderId !== 'string' || !folderId.trim()) return false;

    const folders = permissionRegistry.getApprovedFolders();
    const folder = folders.find((f) => f.id === folderId.trim());
    if (folder) {
      watcherService.unwatch(folder.path);
    }
    return permissionRegistry.removeFolder(folderId.trim());
  });

  ipcMain.handle('folders:toggle', async (event, folderId: unknown, enabled: unknown) => {
    if (!verifyIpcSender(event)) return false;
    if (typeof folderId !== 'string' || typeof enabled !== 'boolean') return false;

    const folders = permissionRegistry.getApprovedFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return false;

    permissionRegistry.toggleFolder(folderId, enabled);
    if (enabled) {
      watcherService.watch(folder.path, folder.id);
      fileIndexer.reconcileFolder(folder).catch((err) => {
        console.error('[IPC] Reconciliation error upon folder re-enable:', err);
      });
    } else {
      watcherService.unwatch(folder.path);
    }
    return true;
  });

  ipcMain.handle('folders:rescan', async (event, folderId: unknown) => {
    if (!verifyIpcSender(event)) return { success: false, error: 'UNAUTHORIZED: Invalid IPC sender' };
    if (typeof folderId !== 'string' || !folderId.trim()) return { success: false, error: 'BAD_REQUEST' };

    const folders = permissionRegistry.getApprovedFolders();
    const folder = folders.find((f) => f.id === folderId.trim());
    if (!folder) return { success: false, error: 'FOLDER_NOT_FOUND' };

    const res = await fileIndexer.reconcileFolder(folder);
    return { success: res.reconciled, fileCount: res.updatedCount };
  });

  // --- File Index Queries ---

  ipcMain.handle('index:query', async (event, folderId?: unknown, limit?: unknown, offset?: unknown, query?: unknown) => {
    if (!verifyIpcSender(event)) return [];

    let validatedFolderId: string | undefined = undefined;
    if (typeof folderId === 'string' && folderId.trim()) {
      const approved = permissionRegistry.getApprovedFolderById(folderId.trim());
      if (!approved) return [];
      validatedFolderId = folderId.trim();
    }

    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 500)
      : 100;
    const safeOffset = typeof offset === 'number' && Number.isFinite(offset) && offset >= 0
      ? Math.floor(offset)
      : 0;
    const safeQuery = typeof query === 'string' ? query.slice(0, 200) : '';

    return databaseService.getFileIndexEntries(validatedFolderId, safeLimit, safeOffset, safeQuery);
  });

  ipcMain.handle('index:stats', async (event) => {
    if (!verifyIpcSender(event)) {
      return { totalFiles: 0, approvedFolderCount: 0, activeWatchersCount: 0 };
    }
    const totalFiles = databaseService.getTotalFileCount();
    const folders = permissionRegistry.getApprovedFolders();
    return {
      totalFiles,
      approvedFolderCount: folders.length,
      activeWatchersCount: folders.filter((f) => f.enabled).length
    };
  });

  ipcMain.handle('activity:getLogs', async (event, limit?: unknown) => {
    if (!verifyIpcSender(event)) return [];
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 200)
      : 50;
    return databaseService.getActivityLogs(safeLimit);
  });

  // --- Native Windows Dialogs ---

  ipcMain.handle('dialog:openDirectory', async (event) => {
    if (!verifyIpcSender(event)) return null;
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

  ipcMain.handle('shell:openPath', async (event, targetPath: unknown) => {
    if (!verifyIpcSender(event)) return false;
    if (!targetPath || typeof targetPath !== 'string') return false;

    // Validate path containment against approved user folders
    const validation = permissionRegistry.isPathWithinApprovedFolder(targetPath);
    if (!validation.isValid) {
      console.warn(`[Security Alert] Blocked attempt to open file outside approved scope: ${targetPath}`);
      return false;
    }

    const res = await shell.openPath(validation.canonicalPath);
    return res === '';
  });

  ipcMain.handle('shell:showItemInFolder', async (event, targetPath: unknown) => {
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

  // --- Real Image Conversion Engine Handlers ---

  ipcMain.handle('conversion:convertImage', async (event, sourcePath: unknown, targetFormat: unknown, options?: unknown) => {
    if (!verifyIpcSender(event)) {
      return { success: false, error: 'UNAUTHORIZED: Invalid IPC sender' };
    }

    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      return { success: false, error: 'BAD_REQUEST: sourcePath must be a non-empty string' };
    }

    if (typeof targetFormat !== 'string' || !targetFormat.trim()) {
      return { success: false, error: 'BAD_REQUEST: targetFormat must be a non-empty string' };
    }

    const cleanSource = sourcePath.trim();

    // Verify source path exists and validate canonical realpath
    try {
      const real = await fs.promises.realpath(cleanSource);
      const stat = await fs.promises.stat(real);
      if (!stat.isFile()) {
        return { success: false, error: 'BAD_REQUEST: Source path is not a file' };
      }
    } catch (err: unknown) {
      return {
        success: false,
        error: `FILE_ACCESS_ERROR: Cannot access source file: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    // Parse options safely without trusting renderer
    const safeOpts: ImageConversionOptions = {};
    if (options && typeof options === 'object') {
      const opt = options as Record<string, unknown>;
      if (typeof opt.quality === 'number' && Number.isFinite(opt.quality)) {
        safeOpts.quality = Math.max(1, Math.min(100, Math.floor(opt.quality)));
      }
      if (typeof opt.backgroundColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(opt.backgroundColor.trim())) {
        safeOpts.backgroundColor = opt.backgroundColor.trim();
      }
      if (typeof opt.outputDirectory === 'string' && opt.outputDirectory.trim()) {
        safeOpts.outputDirectory = opt.outputDirectory.trim();
      }
      if (typeof opt.customFilename === 'string' && opt.customFilename.trim()) {
        safeOpts.customFilename = path.basename(opt.customFilename.trim());
      }
    }

    return imageConverter.convertImage(cleanSource, targetFormat.trim(), safeOpts);
  });

  ipcMain.handle('conversion:getImageMetadata', async (event, sourcePath: unknown) => {
    if (!verifyIpcSender(event)) throw new Error('UNAUTHORIZED: Invalid IPC sender');
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new Error('BAD_REQUEST: sourcePath must be a non-empty string');
    }
    return imageConverter.getImageMetadata(sourcePath.trim());
  });

  ipcMain.handle('conversion:getJobs', async (event, limit?: unknown) => {
    if (!verifyIpcSender(event)) return [];
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 200)
      : 50;
    const records = databaseService.getConversionJobs(safeLimit);
    return records.map((r) => ({
      id: r.id,
      sourcePath: r.source_path,
      sourceFileName: r.source_filename,
      inputFormat: r.input_format,
      outputFormat: r.output_format,
      outputPath: r.output_path || undefined,
      status: r.status,
      progress: r.progress,
      createdAt: r.created_at,
      startedAt: r.started_at || undefined,
      completedAt: r.completed_at || undefined,
      durationMs: r.duration_ms || undefined,
      errorCode: r.error_code || undefined,
      errorMessage: r.error_message || undefined
    }));
  });

  // --- Window Control ---

  ipcMain.on('window:setIgnoreMouseEvents', (event, ignore: unknown, forward?: unknown) => {
    if (!verifyIpcSender(event)) return;
    if (typeof ignore !== 'boolean') return;
    const safeForward = typeof forward === 'boolean' ? forward : false;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: safeForward });
    }
  });

  ipcMain.on('window:minimize', (event) => {
    if (!verifyIpcSender(event)) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  ipcMain.on('window:close', (event) => {
    if (!verifyIpcSender(event)) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
}
