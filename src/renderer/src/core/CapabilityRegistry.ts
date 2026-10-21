import { FileCategory, RadialSector } from '../../../shared/types';

export const CAPABILITY_SECTORS: Record<FileCategory, RadialSector[]> = {
  image: [
    {
      id: 'img-png',
      label: 'PNG',
      format: 'png',
      description: 'Lossless with Alpha Transparency',
      category: 'image',
      accentColor: '#38bdf8'
    },
    {
      id: 'img-jpg',
      label: 'JPEG',
      format: 'jpg',
      description: 'Compact Photo Compression',
      category: 'image',
      accentColor: '#fb923c'
    },
    {
      id: 'img-webp',
      label: 'WEBP',
      format: 'webp',
      description: 'Modern Web Standard Format',
      category: 'image',
      accentColor: '#ec4899'
    },
    {
      id: 'img-bmp',
      label: 'BMP',
      format: 'bmp',
      description: 'Uncompressed Windows Bitmap',
      category: 'image',
      accentColor: '#a855f7'
    }
  ],
  video: [
    {
      id: 'vid-mp4',
      label: 'MP4',
      format: 'mp4',
      description: 'Universal H.264 / AAC Container',
      category: 'video',
      accentColor: '#f97316'
    },
    {
      id: 'vid-webm',
      label: 'WEBM',
      format: 'webm',
      description: 'Open VP9 Web Video Format',
      category: 'video',
      accentColor: '#6366f1'
    }
  ],
  document: [
    {
      id: 'doc-pdf',
      label: 'PDF',
      format: 'pdf',
      description: 'Portable Document Layout',
      category: 'document',
      accentColor: '#ef4444'
    },
    {
      id: 'doc-docx',
      label: 'DOCX',
      format: 'docx',
      description: 'Editable Word Document',
      category: 'document',
      accentColor: '#2563eb'
    },
    {
      id: 'doc-txt',
      label: 'TXT',
      format: 'txt',
      description: 'Clean Plain Text Extraction',
      category: 'document',
      accentColor: '#10b981'
    }
  ],
  generic_file: [
    {
      id: 'gen-png',
      label: 'PNG',
      format: 'png',
      description: 'To Image (Lossless)',
      category: 'image',
      accentColor: '#38bdf8'
    },
    {
      id: 'gen-jpg',
      label: 'JPEG',
      format: 'jpg',
      description: 'To Image (Photo)',
      category: 'image',
      accentColor: '#fb923c'
    },
    {
      id: 'gen-mp4',
      label: 'MP4',
      format: 'mp4',
      description: 'To Video (H.264)',
      category: 'video',
      accentColor: '#f97316'
    },
    {
      id: 'gen-pdf',
      label: 'PDF',
      format: 'pdf',
      description: 'To Document (PDF)',
      category: 'document',
      accentColor: '#ef4444'
    },
    {
      id: 'gen-docx',
      label: 'DOCX',
      format: 'docx',
      description: 'To Document (Word)',
      category: 'document',
      accentColor: '#2563eb'
    },
    {
      id: 'gen-txt',
      label: 'TXT',
      format: 'txt',
      description: 'To Plain Text',
      category: 'document',
      accentColor: '#10b981'
    }
  ],
  unknown: []
};

export interface CompatibilityCheck {
  isSupported: boolean;
  isSameFormat: boolean;
  reason?: string;
  targetFormat?: string;
}

export function getCompatibleSectors(category: FileCategory): RadialSector[] {
  return CAPABILITY_SECTORS[category] || [];
}

export function validateConversionCompatibility(
  sourceExtension: string,
  targetFormat: string,
  category: FileCategory
): CompatibilityCheck {
  const normSource = sourceExtension.toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
  const normTarget = targetFormat.toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');

  if (category === 'unknown') {
    return {
      isSupported: false,
      isSameFormat: false,
      reason: 'This file format is not currently supported. Radial File Studio converts Images, Videos, and Documents.'
    };
  }

  // Cross-category validation: target format category must match source category
  let actualCategory = category;
  if (category === 'generic_file') {
    // Determine category from the true extension
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'].includes(normSource)) actualCategory = 'image';
    else if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(normSource)) actualCategory = 'video';
    else if (['pdf', 'docx', 'doc', 'txt', 'xlsx', 'pptx'].includes(normSource)) actualCategory = 'document';
    else {
      return {
        isSupported: false,
        isSameFormat: false,
        reason: `Unsupported source file (.${normSource.toUpperCase()}). Radial converts Images, Videos, and Documents.`
      };
    }
  }

  const validSectors = getCompatibleSectors(actualCategory);
  const isValidTarget = validSectors.some((s) => s.format.toLowerCase() === normTarget);

  if (!isValidTarget) {
    return {
      isSupported: false,
      isSameFormat: false,
      reason: `Target format .${targetFormat.toUpperCase()} is not compatible with ${actualCategory} files (.${normSource.toUpperCase()}).`
    };
  }

  if (normSource === normTarget) {
    return {
      isSupported: true,
      isSameFormat: true,
      reason: `Source file is already .${targetFormat.toUpperCase()}. Conversion will create an optimized copy without overwriting.`,
      targetFormat: normTarget
    };
  }

  return {
    isSupported: true,
    isSameFormat: false,
    targetFormat: normTarget
  };
}
