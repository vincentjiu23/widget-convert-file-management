import { ClassifiedFile, FileCategory } from '../../../shared/types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'tif', 'tiff', 'heic', 'heif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'flv', 'wmv']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'txt', 'rtf', 'odt', 'xlsx', 'xls', 'csv', 'pptx', 'ppt']);

export function extractExtension(filePathOrName: string): string {
  const clean = filePathOrName.split('?')[0].split('#')[0];
  const parts = clean.split('.');
  if (parts.length <= 1) return '';
  return parts.pop()?.toLowerCase().trim() || '';
}

export function detectFileCategory(extension: string, mimeType?: string): FileCategory {
  const ext = extension.toLowerCase().replace(/^\./, '');

  if (IMAGE_EXTENSIONS.has(ext) || (mimeType && mimeType.startsWith('image/'))) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(ext) || (mimeType && mimeType.startsWith('video/'))) {
    return 'video';
  }
  if (DOCUMENT_EXTENSIONS.has(ext) || (mimeType && (mimeType.includes('pdf') || mimeType.includes('text/') || mimeType.includes('word') || mimeType.includes('document')))) {
    return 'document';
  }

  return 'unknown';
}

export function classifyFile(file: { name: string; path?: string; type?: string; size?: number }): ClassifiedFile {
  const extension = extractExtension(file.name);
  const category = detectFileCategory(extension, file.type);

  return {
    name: file.name,
    path: file.path || file.name,
    extension,
    category,
    mimeType: file.type,
    sizeBytes: file.size
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

  const isHomogeneous = classified.length > 0 && classified.every(f => f.category === classified[0].category && f.category !== 'unknown');

  return {
    totalFiles: classified.length,
    files: classified,
    dominantCategory,
    isHomogeneous,
    unsupportedCount
  };
}
