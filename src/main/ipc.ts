import fs from 'fs';
import path from 'path';
import { ipcMain, dialog, shell, BrowserWindow, screen } from 'electron';
import { FolderPermissionRegistry } from './security/FolderPermissionRegistry';
import { DirectoryWatcherService } from './watcher';
import { FileIndexer } from './indexer/FileIndexer';
import { DatabaseService } from './database/DatabaseService';
import { ImageConverter, ImageConversionOptions } from './converter/ImageConverter';
import { DocumentConverter, DocumentConversionOptions } from './converter/DocumentConverter';
import { ConversionJob } from '../shared/types';

/**
 * Validate that an IPC event originates strictly from a trusted BrowserWindow.
 * Rejects renderer frames from devtools, external protocols, or spoofed senders.
 */
export function isTrustedIpcSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  trustedWindowOrWindows: BrowserWindow | null | (BrowserWindow | null)[]
): boolean {
  if (!trustedWindowOrWindows) return false;
  const windows = Array.isArray(trustedWindowOrWindows) ? trustedWindowOrWindows : [trustedWindowOrWindows];
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    try {
      if (event.sender === win.webContents) {
        if ((event as Electron.IpcMainInvokeEvent).senderFrame && win.webContents.mainFrame) {
          if ((event as Electron.IpcMainInvokeEvent).senderFrame !== win.webContents.mainFrame) {
            continue;
          }
        }
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export interface WindowControllers {
  getDashboardWindow: () => BrowserWindow | null;
  getWidgetWindow: () => BrowserWindow | null;
  openDashboardWindow: () => BrowserWindow;
  toggleWidgetWindow: (visible?: boolean) => boolean;
}

export function setupIpcHandlers(
  windowControllers: WindowControllers,
  permissionRegistry: FolderPermissionRegistry,
  watcherService: DirectoryWatcherService,
  fileIndexer: FileIndexer,
  databaseService: DatabaseService,
  imageConverter: ImageConverter,
  documentConverter: DocumentConverter
): void {
  function verifyIpcSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
    const wins = [windowControllers.getDashboardWindow(), windowControllers.getWidgetWindow()];
    return isTrustedIpcSender(event, wins);
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

  // --- Security & Path Verification ---

  ipcMain.handle('security:checkPath', async (event, targetPath: unknown) => {
    if (!verifyIpcSender(event)) {
      return { exists: false, isFile: false, isApproved: false, canonicalPath: '', error: 'UNAUTHORIZED: Invalid IPC sender' };
    }
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      return { exists: false, isFile: false, isApproved: false, canonicalPath: '', error: 'BAD_REQUEST: targetPath must be a non-empty string' };
    }

    const clean = targetPath.trim();
    if (!path.isAbsolute(clean)) {
      return { exists: false, isFile: false, isApproved: false, canonicalPath: '', error: 'BAD_REQUEST: targetPath must be an absolute path' };
    }

    try {
      if (!fs.existsSync(clean)) {
        return { exists: false, isFile: false, isApproved: false, canonicalPath: clean, error: 'FILE_NOT_FOUND' };
      }
      const real = await fs.promises.realpath(clean);
      const stat = await fs.promises.stat(real);
      if (!stat.isFile()) {
        return { exists: true, isFile: false, isApproved: false, canonicalPath: real, error: 'NOT_A_FILE' };
      }

      const validation = permissionRegistry.isPathWithinApprovedFolder(real);
      const dirPath = path.dirname(real);
      const dirName = path.basename(dirPath) || dirPath;

      return {
        exists: true,
        isFile: true,
        isApproved: validation.isValid,
        canonicalPath: real,
        folderPath: dirPath,
        folderName: dirName
      };
    } catch (err: unknown) {
      return {
        exists: false,
        isFile: false,
        isApproved: false,
        canonicalPath: clean,
        error: err instanceof Error ? err.message : String(err)
      };
    }
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
    const win = BrowserWindow.fromWebContents(event.sender) || windowControllers.getDashboardWindow() || windowControllers.getWidgetWindow();
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

  ipcMain.handle('dialog:openFile', async (event, filters?: unknown) => {
    if (!verifyIpcSender(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender) || windowControllers.getDashboardWindow() || windowControllers.getWidgetWindow();
    if (!win) return null;

    const fileFilters = Array.isArray(filters)
      ? (filters as Array<{ name: string; extensions: string[] }>)
      : [
          { name: 'Supported Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif', 'pdf'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] },
          { name: 'Documents', extensions: ['pdf'] },
          { name: 'All Files', extensions: ['*'] }
        ];

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'dontAddToRecent'],
      filters: fileFilters,
      title: 'Select File to Convert'
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

  // --- Conversion Engines (Image + Document + Unified Dispatcher) ---

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
    let realSource: string;
    try {
      realSource = await fs.promises.realpath(cleanSource);
      const stat = await fs.promises.stat(realSource);
      if (!stat.isFile()) {
        return { success: false, error: 'BAD_REQUEST: Source path is not a file' };
      }
    } catch (err: unknown) {
      return {
        success: false,
        error: `FILE_ACCESS_ERROR: Cannot access source file: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    const sourceValidation = permissionRegistry.isPathWithinApprovedFolder(realSource);
    if (!sourceValidation.isValid) {
      console.warn(`[Security Alert] Blocked conversion of file outside approved scope: ${realSource}`);
      return { success: false, error: 'SECURITY_VIOLATION: Source file is not within approved folders.' };
    }

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
        const outDirValidation = permissionRegistry.isPathWithinApprovedFolder(opt.outputDirectory.trim());
        if (!outDirValidation.isValid) {
          console.warn(`[Security Alert] Blocked output to unapproved directory: ${opt.outputDirectory}`);
          return { success: false, error: 'SECURITY_VIOLATION: Output directory is not within approved folders.' };
        }
        safeOpts.outputDirectory = outDirValidation.canonicalPath;
      }
      if (typeof opt.customFilename === 'string' && opt.customFilename.trim()) {
        safeOpts.customFilename = path.basename(opt.customFilename.trim());
      }
    }

    return imageConverter.convertImage(realSource, targetFormat.trim(), safeOpts);
  });

  ipcMain.handle('conversion:convertDocument', async (event, sourcePath: unknown, targetFormat: unknown, options?: unknown) => {
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
    let realSource: string;
    try {
      realSource = await fs.promises.realpath(cleanSource);
      const stat = await fs.promises.stat(realSource);
      if (!stat.isFile()) {
        return { success: false, error: 'BAD_REQUEST: Source path is not a file' };
      }
    } catch (err: unknown) {
      return {
        success: false,
        error: `FILE_ACCESS_ERROR: Cannot access source file: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    const sourceValidation = permissionRegistry.isPathWithinApprovedFolder(realSource);
    if (!sourceValidation.isValid) {
      console.warn(`[Security Alert] Blocked document conversion outside approved scope: ${realSource}`);
      return { success: false, error: 'SECURITY_VIOLATION: Source file is not within approved folders.' };
    }

    const safeOpts: DocumentConversionOptions = {};
    if (options && typeof options === 'object') {
      const opt = options as Record<string, unknown>;
      if (typeof opt.outputDirectory === 'string' && opt.outputDirectory.trim()) {
        const outDirValidation = permissionRegistry.isPathWithinApprovedFolder(opt.outputDirectory.trim());
        if (!outDirValidation.isValid) {
          return { success: false, error: 'SECURITY_VIOLATION: Output directory is not within approved folders.' };
        }
        safeOpts.outputDirectory = outDirValidation.canonicalPath;
      }
      if (typeof opt.customFilename === 'string' && opt.customFilename.trim()) {
        safeOpts.customFilename = path.basename(opt.customFilename.trim());
      }
    }

    return documentConverter.convertDocument(realSource, targetFormat.trim(), safeOpts);
  });

  // Generic Unified Converter: delegates cleanly by file type and records consistent state
  ipcMain.handle('conversion:convertFile', async (event, sourcePath: unknown, targetFormat: unknown, options?: unknown) => {
    if (!verifyIpcSender(event)) {
      return { success: false, error: 'UNAUTHORIZED: Invalid IPC sender', status: 'FAILED' };
    }

    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      return { success: false, error: 'BAD_REQUEST: sourcePath must be a non-empty string', status: 'FAILED' };
    }
    if (typeof targetFormat !== 'string' || !targetFormat.trim()) {
      return { success: false, error: 'BAD_REQUEST: targetFormat must be a non-empty string', status: 'FAILED' };
    }

    const cleanSource = sourcePath.trim();
    if (!path.isAbsolute(cleanSource)) {
      return {
        success: false,
        error: 'BAD_REQUEST: sourcePath must be an absolute filesystem path. File names without directory paths cannot be converted.',
        status: 'FAILED'
      };
    }

    if (!fs.existsSync(cleanSource)) {
      return {
        success: false,
        error: `FILE_NOT_FOUND: Source file does not exist: ${cleanSource}`,
        status: 'FAILED'
      };
    }

    const cleanTarget = targetFormat.trim().toLowerCase().replace(/^\./, '');
    const ext = path.extname(cleanSource).toLowerCase().replace(/^\./, '');

    const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'];
    const isImage = imageExts.includes(ext);
    const isPdf = ext === 'pdf';

    try {
      if (isImage) {
        return await imageConverter.convertImage(cleanSource, cleanTarget, options as ImageConversionOptions);
      }

      if (isPdf && cleanTarget === 'txt') {
        return await documentConverter.convertDocument(cleanSource, cleanTarget, options as DocumentConversionOptions);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC conversion:convertFile] Conversion error:', err);
      return {
        success: false,
        error: `Conversion failed: ${msg}`,
        status: 'FAILED'
      };
    }

    // Unsupported conversion request: record honest database entry and return informative error
    const jobId = `job-unsup-${Date.now()}`;
    const filename = path.basename(cleanSource);
    const reason = isPdf
      ? `PDF target format .${cleanTarget.toUpperCase()} is not supported. Currently only PDF to TXT text extraction is available.`
      : `Conversion from .${ext.toUpperCase()} to .${cleanTarget.toUpperCase()} is not supported.`;

    databaseService.insertConversionJob({
      id: jobId,
      source_path: cleanSource,
      source_filename: filename,
      input_format: ext || 'unknown',
      output_format: cleanTarget,
      output_path: null,
      status: 'UNSUPPORTED',
      progress: 0,
      created_at: Date.now(),
      completed_at: Date.now(),
      error_code: 'UNSUPPORTED_CONVERSION',
      error_message: reason
    });

    databaseService.logActivity({
      event_type: 'CONVERSION_UNSUPPORTED',
      resource_type: 'CONVERSION_JOB',
      resource_id: jobId,
      summary: `Conversion rejected: ${filename} (.${ext} -> .${cleanTarget}) is unsupported`,
      details: { source: cleanSource, targetFormat: cleanTarget, reason }
    });

    return {
      success: false,
      jobId,
      sourcePath: cleanSource,
      error: reason,
      status: 'UNSUPPORTED'
    };
  });

  ipcMain.handle('conversion:retryJob', async (event, jobId: unknown) => {
    if (!verifyIpcSender(event)) return { success: false, error: 'UNAUTHORIZED' };
    if (typeof jobId !== 'string' || !jobId.trim()) return { success: false, error: 'BAD_REQUEST' };

    const job = databaseService.getConversionJobById(jobId.trim());
    if (!job) return { success: false, error: 'JOB_NOT_FOUND' };

    // Re-dispatch using convertFile logic
    const ext = path.extname(job.source_path).toLowerCase().replace(/^\./, '');
    const isImage = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'].includes(ext);

    if (isImage) {
      return imageConverter.convertImage(job.source_path, job.output_format);
    } else if (ext === 'pdf' && job.output_format.toLowerCase() === 'txt') {
      return documentConverter.convertDocument(job.source_path, job.output_format);
    }

    return { success: false, error: `Conversion for .${ext} to .${job.output_format} is unsupported.` };
  });

  ipcMain.handle('conversion:cancelJob', async (event, jobId: unknown) => {
    if (!verifyIpcSender(event)) return false;
    if (typeof jobId !== 'string' || !jobId.trim()) return false;

    const job = databaseService.getConversionJobById(jobId.trim());
    if (!job) return false;

    if (job.status === 'QUEUED' || job.status === 'RUNNING') {
      databaseService.updateConversionJob(job.id, {
        status: 'CANCELLED',
        completed_at: Date.now(),
        error_message: 'Job cancelled by user'
      });
      return true;
    }
    return false;
  });

  ipcMain.handle('conversion:clearCompleted', async (event) => {
    if (!verifyIpcSender(event)) return false;
    databaseService.clearCompletedJobs();
    return true;
  });

  ipcMain.handle('conversion:getImageMetadata', async (event, sourcePath: unknown) => {
    if (!verifyIpcSender(event)) throw new Error('UNAUTHORIZED: Invalid IPC sender');
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new Error('BAD_REQUEST: sourcePath must be a non-empty string');
    }

    const cleanSource = sourcePath.trim();
    let realSource: string;
    try {
      realSource = await fs.promises.realpath(cleanSource);
    } catch {
      throw new Error(`FILE_ACCESS_ERROR: Cannot resolve source path: ${cleanSource}`);
    }

    const validation = permissionRegistry.isPathWithinApprovedFolder(realSource);
    if (!validation.isValid) {
      throw new Error('SECURITY_VIOLATION: Source file is not within approved folders.');
    }

    return imageConverter.getImageMetadata(realSource);
  });

  ipcMain.handle('conversion:getJobs', async (event, limit?: unknown) => {
    if (!verifyIpcSender(event)) return [];
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 200)
      : 50;
    const records = databaseService.getConversionJobs(safeLimit);
    return records.map((r): ConversionJob => ({
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

  // --- Window Control & Dual-Mode Coordination ---

  ipcMain.handle('window:openDashboard', async (event) => {
    if (!verifyIpcSender(event)) return false;
    const dash = windowControllers.openDashboardWindow();
    if (dash) {
      if (dash.isMinimized()) dash.restore();
      dash.focus();
      return true;
    }
    return false;
  });

  ipcMain.handle('window:toggleWidget', async (event, visible?: unknown) => {
    if (!verifyIpcSender(event)) return false;
    const isVis = typeof visible === 'boolean' ? visible : undefined;
    return windowControllers.toggleWidgetWindow(isVis);
  });

  ipcMain.handle('window:getWidgetState', async (event) => {
    if (!verifyIpcSender(event)) return null;
    const widgetWin = windowControllers.getWidgetWindow();
    const savedBounds = databaseService.getSetting<{ x: number; y: number; width: number; height: number } | null>(
      'widget_position',
      null
    );
    const alwaysOnTop = databaseService.getSetting<boolean>('widget_always_on_top', false);

    return {
      isVisible: widgetWin ? widgetWin.isVisible() : false,
      isAlwaysOnTop: alwaysOnTop,
      bounds: widgetWin && !widgetWin.isDestroyed() ? widgetWin.getBounds() : savedBounds
    };
  });

  ipcMain.handle('widget:savePosition', async (event, bounds: unknown) => {
    if (!verifyIpcSender(event)) return false;
    if (!bounds || typeof bounds !== 'object') return false;
    const b = bounds as Record<string, unknown>;
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      databaseService.setSetting('widget_position', {
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: typeof b.width === 'number' ? Math.round(b.width) : 380,
        height: typeof b.height === 'number' ? Math.round(b.height) : 380
      });
      return true;
    }
    return false;
  });

  // Mouse event pass-through control (for frameless widget)
  ipcMain.on('window:setIgnoreMouseEvents', (event, ignore: unknown, forward?: unknown) => {
    if (!verifyIpcSender(event)) return;
    if (typeof ignore !== 'boolean') return;
    const safeForward = typeof forward === 'boolean' ? forward : false;
    const widgetWin = windowControllers.getWidgetWindow();
    if (widgetWin && !widgetWin.isDestroyed()) {
      widgetWin.setIgnoreMouseEvents(ignore, { forward: safeForward });
    }
  });

  ipcMain.on('window:minimize', (event) => {
    if (!verifyIpcSender(event)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  ipcMain.on('window:close', (event) => {
    if (!verifyIpcSender(event)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
}
