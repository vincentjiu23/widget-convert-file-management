import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  RadialAPI,
  ApprovedFolder,
  FileIndexItem,
  IndexStats,
  ActivityLogItem,
  ScanProgress
} from '../shared/types';

const radialAPI: RadialAPI = {
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || file.name;
    } catch {
      return file.name;
    }
  },

  openFolderPicker: async (): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:openDirectory');
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
