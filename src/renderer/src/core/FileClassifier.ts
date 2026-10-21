import { ClassifiedFile, FileCategory } from '../../../shared/types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'tif', 'tiff', 'heic', 'heif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'flv', 'wmv']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'txt', 'rtf', 'odt', 'xlsx', 'xls', 'csv', 'pptx', 'ppt']);
const KNOWN_UNSUPPORTED_EXTENSIONS = new Set(['exe', 'msi', 'zip', 'rar', '7z', 'tar', 'gz', 'iso', 'dll', 'sys', 'bat', 'cmd', 'ps1', 'vbs']);

export function extractExtension(filePathOrName: string): string {
  const clean = filePathOrName.split('?')[0].split('#')[0];
  const parts = clean.split('.');
  if (parts.length <= 1) return '';
  return parts.pop()?.toLowerCase().trim() || '';
}

export function detectFileCategory(extension: string, mimeType?: string): FileCategory {
  const ext = extension.toLowerCase().replace(/^\./, '');

  // 1. Direct extension matches (Primary authority on Windows)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (KNOWN_UNSUPPORTED_EXTENSIONS.has(ext)) return 'unknown';

  // 2. MIME type inspection
  if (mimeType && mimeType.trim() !== '') {
    const cleanMime = mimeType.toLowerCase();
    if (cleanMime.startsWith('image/')) return 'image';
    if (cleanMime.startsWith('video/')) return 'video';
    if (
      cleanMime.includes('pdf') ||
      cleanMime.startsWith('text/') ||
      cleanMime.includes('word') ||
      cleanMime.includes('document') ||
      cleanMime.includes('sheet') ||
      cleanMime.includes('presentation')
    ) {
      return 'document';
    }
  }

  // 3. Fallback when neither extension nor MIME is available during dragover
  if (!ext && (!mimeType || mimeType.trim() === '' || mimeType === 'application/octet-stream')) {
    return 'generic_file';
  }

  return 'unknown';
}

export function classifyFile(file: { name: string; path?: string; type?: string; size?: number }): ClassifiedFile {
  const extension = extractExtension(file.name);
  const category = detectFileCategory(extension, file.type);
  const isMimePending = category === 'generic_file';

  return {
    name: file.name,
    path: file.path || file.name,
    extension,
    category,
    mimeType: file.type,
    sizeBytes: file.size,
    isMimePending
  };
}

export interface MultiFileClassification {
  totalFiles: number;
  files: ClassifiedFile[];
  dominantCategory: FileCategory;
  isHomogeneous: boolean;
  unsupportedCount: number;
}

export function classifyMultipleFiles(files: Array<{ name: string; path?: string; type?: string; size?: number }>): MultiFileClassification {
  const classified = files.map(classifyFile);
  const categoryCounts = new Map<FileCategory, number>();

  let unsupportedCount = 0;
  for (const f of classified) {
    if (f.category === 'unknown') {
      unsupportedCount++;
    }
    categoryCounts.set(f.category, (categoryCounts.get(f.category) || 0) + 1);
  }

  let dominantCategory: FileCategory = 'unknown';
  let maxCount = 0;
  for (const [cat, count] of categoryCounts.entries()) {
    if (cat !== 'unknown' && count > maxCount) {
      maxCount = count;
      dominantCategory = cat;
    }
  }

  const isHomogeneous =
    classified.length > 0 &&
    classified.every((f) => f.category === classified[0].category && f.category !== 'unknown');

  return {
    totalFiles: classified.length,
    files: classified,
    dominantCategory,
    isHomogeneous,
    unsupportedCount
  };
}
