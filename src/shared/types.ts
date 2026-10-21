export type FileCategory = 'image' | 'video' | 'document' | 'unknown' | 'generic_file';

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
  isMimePending?: boolean;
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

export interface ApprovedFolder {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  added_at: number;
  last_scan_at: number | null;
  scan_status: string;
  file_count: number;
}

export interface FileIndexItem {
  id: string;
  folder_id: string;
  path: string;
  parent_path: string;
  name: string;
  extension: string;
  category: string;
  size_bytes: number;
  mtime_ms: number;
  ctime_ms: number;
  indexed_at: number;
  index_status: string;
  error_message?: string | null;
}

export interface ScanProgress {
  folderId: string;
  folderPath: string;
  scannedFiles: number;
  currentPath: string;
  isComplete: boolean;
  error?: string;
}

export interface ActivityLogItem {
  id: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  summary: string;
  timestamp: number;
  details_json?: string;
}

export interface IndexStats {
  totalFiles: number;
  approvedFolderCount: number;
  activeWatchersCount: number;
}

export interface RadialAPI {
  getPathForFile: (file: File) => string;
  openFolderPicker: () => Promise<string | null>;
  openPath: (path: string) => Promise<boolean>;
  showItemInFolder: (path: string) => Promise<boolean>;
  getApprovedFolders: () => Promise<ApprovedFolder[]>;
  addApprovedFolder: (path: string, name?: string) => Promise<{ success: boolean; folder?: ApprovedFolder; error?: string }>;
  removeApprovedFolder: (folderId: string) => Promise<boolean>;
  toggleApprovedFolder: (folderId: string, enabled: boolean) => Promise<boolean>;
  rescanApprovedFolder: (folderId: string) => Promise<{ success: boolean; fileCount?: number; error?: string }>;
  queryIndex: (folderId?: string, limit?: number, offset?: number, query?: string) => Promise<FileIndexItem[]>;
  getIndexStats: () => Promise<IndexStats>;
  getActivityLogs: (limit?: number) => Promise<ActivityLogItem[]>;
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => void;
  minimizeWidget: () => void;
  closeWidget: () => void;
  onDirectoryChanged: (callback: (event: { folderId: string; dirPath: string; eventType: string; filename: string; timestamp: number }) => void) => () => void;
  onIndexerProgress: (callback: (progress: ScanProgress) => void) => () => void;
}

declare global {
  interface Window {
    radialAPI?: RadialAPI;
  }
}
