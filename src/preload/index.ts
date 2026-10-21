import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { RadialAPI } from '../shared/types';

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

  watchDirectory: async (dirPath: string): Promise<boolean> => {
    return ipcRenderer.invoke('watcher:start', dirPath);
  },

  unwatchDirectory: async (dirPath: string): Promise<boolean> => {
    return ipcRenderer.invoke('watcher:stop', dirPath);
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

  onDirectoryChanged: (callback: (event: { eventType: string; filename: string }) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: { eventType: string; filename: string }) => {
      callback(data);
    };
    ipcRenderer.on('fs:directory-changed', subscription);
    return () => {
      ipcRenderer.removeListener('fs:directory-changed', subscription);
    };
  }
};

contextBridge.exposeInMainWorld('radialAPI', radialAPI);
