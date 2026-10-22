import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  RadialAPI,
  ApprovedFolder,
  FileIndexItem,
  IndexStats,
  ActivityLogItem,
  ScanProgress,
  WidgetState
} from '../shared/types';

const radialAPI: RadialAPI = {
  getPathForFile: (file: File): string => {
    try {
      if (!file) return '';
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        const resolved = webUtils.getPathForFile(file);
        if (resolved && typeof resolved === 'string' && resolved.trim()) {
          return resolved.trim();
        }
      }
      if ('path' in file && typeof (file as any).path === 'string' && (file as any).path.trim()) {
        return (file as any).path.trim();
      }
      return '';
    } catch (err) {
      console.warn('[Preload getPathForFile] Resolution error:', err);
      return '';
    }
  },

  checkPathPermission: async (targetPath: string) => {
    return ipcRenderer.invoke('security:checkPath', targetPath);
  },

  openFolderPicker: async (): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:openDirectory');
  },

  openFilePicker: async (filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:openFile', filters);
  },

  openPath: async (targetPath: string): Promise<boolean> => {
    return ipcRenderer.invoke('shell:openPath', targetPath);
  },

  showItemInFolder: async (targetPath: string): Promise<boolean> => {
    return ipcRenderer.invoke('shell:showItemInFolder', targetPath);
  },

  getApprovedFolders: async (): Promise<ApprovedFolder[]> => {
    return ipcRenderer.invoke('folders:getApproved');
  },

  addApprovedFolder: async (folderPath: string, name?: string) => {
    return ipcRenderer.invoke('folders:add', folderPath, name);
  },

  removeApprovedFolder: async (folderId: string): Promise<boolean> => {
    return ipcRenderer.invoke('folders:remove', folderId);
  },

  toggleApprovedFolder: async (folderId: string, enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('folders:toggle', folderId, enabled);
  },

  rescanApprovedFolder: async (folderId: string) => {
    return ipcRenderer.invoke('folders:rescan', folderId);
  },

  queryIndex: async (folderId?: string, limit = 100, offset = 0, query = ''): Promise<FileIndexItem[]> => {
    return ipcRenderer.invoke('index:query', folderId, limit, offset, query);
  },

  getIndexStats: async (): Promise<IndexStats> => {
    return ipcRenderer.invoke('index:stats');
  },

  getActivityLogs: async (limit = 50): Promise<ActivityLogItem[]> => {
    return ipcRenderer.invoke('activity:getLogs', limit);
  },

  convertImage: async (sourcePath: string, targetFormat: string, options?: { quality?: number; backgroundColor?: string; outputDirectory?: string }) => {
    return ipcRenderer.invoke('conversion:convertImage', sourcePath, targetFormat, options);
  },

  convertDocument: async (sourcePath: string, options?: { outputDirectory?: string; customFilename?: string }) => {
    return ipcRenderer.invoke('conversion:convertDocument', sourcePath, 'txt', options);
  },

  convertFile: async (sourcePath: string, targetFormat: string, options?: { quality?: number; outputDirectory?: string }) => {
    return ipcRenderer.invoke('conversion:convertFile', sourcePath, targetFormat, options);
  },

  getImageMetadata: async (sourcePath: string) => {
    return ipcRenderer.invoke('conversion:getImageMetadata', sourcePath);
  },

  getConversionJobs: async (limit = 50) => {
    return ipcRenderer.invoke('conversion:getJobs', limit);
  },

  clearCompletedJobs: async () => {
    return ipcRenderer.invoke('conversion:clearCompleted');
  },

  retryJob: async (jobId: string) => {
    return ipcRenderer.invoke('conversion:retryJob', jobId);
  },

  cancelJob: async (jobId: string) => {
    return ipcRenderer.invoke('conversion:cancelJob', jobId);
  },

  openDashboardWindow: async () => {
    return ipcRenderer.invoke('window:openDashboard');
  },

  toggleDesktopWidget: async (visible?: boolean) => {
    return ipcRenderer.invoke('window:toggleWidget', visible);
  },

  getWidgetState: async (): Promise<WidgetState> => {
    return ipcRenderer.invoke('window:getWidgetState');
  },

  saveWidgetPosition: async (x: number, y: number) => {
    return ipcRenderer.invoke('widget:savePosition', { x, y });
  },

  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean): void => {
    ipcRenderer.send('window:setIgnoreMouseEvents', ignore, forward);
  },

  minimizeWidget: (): void => {
    ipcRenderer.send('window:minimize');
  },

  closeWidget: (): void => {
    ipcRenderer.send('window:close');
  },

  onDirectoryChanged: (callback: (event: { folderId: string; dirPath: string; eventType: string; filename: string; timestamp: number }) => void) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      data: { folderId: string; dirPath: string; eventType: string; filename: string; timestamp: number }
    ) => {
      callback(data);
    };
    ipcRenderer.on('fs:directory-changed', subscription);
    return () => {
      ipcRenderer.removeListener('fs:directory-changed', subscription);
    };
  },

  onIndexerProgress: (callback: (progress: ScanProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: ScanProgress) => {
      callback(data);
    };
    ipcRenderer.on('indexer:progress', subscription);
    return () => {
      ipcRenderer.removeListener('indexer:progress', subscription);
    };
  }
};

contextBridge.exposeInMainWorld('radialAPI', radialAPI);
