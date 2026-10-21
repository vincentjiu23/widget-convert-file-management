export type FileCategory = 'image' | 'video' | 'document' | 'unknown';

export type RadialInteractionState =
  | 'IDLE'
  | 'FILE_HOVER'
  | 'TYPE_DETECTED'
  | 'FORMAT_RING_VISIBLE'
  | 'SECTOR_HOVER'
  | 'DROP_VALIDATION'
  | 'JOB_QUEUED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'ERROR';

export interface RadialSector {
  id: string;
  label: string;
  format: string;
  description: string;
  category: FileCategory;
  accentColor: string;
}

export interface ClassifiedFile {
  name: string;
  path: string;
  extension: string;
  category: FileCategory;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ConversionJob {
  id: string;
  sourcePath: string;
  sourceFileName: string;
  inputFormat: string;
  outputFormat: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  outputPath?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SelectedFolder {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  addedAt: number;
  lastScannedAt?: number;
  fileCount?: number;
  scanStatus?: 'IDLE' | 'SCANNING' | 'ERROR';
}

export interface RadialAPI {
  getPathForFile: (file: File) => string;
  openFolderPicker: () => Promise<string | null>;
  openPath: (path: string) => Promise<boolean>;
  showItemInFolder: (path: string) => Promise<boolean>;
  watchDirectory: (path: string) => Promise<boolean>;
  unwatchDirectory: (path: string) => Promise<boolean>;
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => void;
  minimizeWidget: () => void;
  closeWidget: () => void;
  onDirectoryChanged: (callback: (event: { eventType: string; filename: string }) => void) => () => void;
}

declare global {
  interface Window {
    radialAPI?: RadialAPI;
  }
}
