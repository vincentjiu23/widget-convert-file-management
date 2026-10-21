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
    },
    {
      id: 'img-tiff',
      label: 'TIFF',
      format: 'tiff',
      description: 'High-Fidelity Archival Raster',
      category: 'image',
      accentColor: '#10b981'
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
  // When file identity is pending/unknown, do NOT fake a format list. Show empty sectors.
  generic_file: [],
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

  if (category === 'unknown' || category === 'generic_file') {
    return {
      isSupported: false,
      isSameFormat: false,
      reason: 'Please drop the file onto the primary circle first to identify category and reveal compatible formats.'
    };
  }

  const validSectors = getCompatibleSectors(category);
  const isValidTarget = validSectors.some((s) => s.format.toLowerCase() === normTarget);

  if (!isValidTarget) {
    return {
      isSupported: false,
      isSameFormat: false,
      reason: `Target format .${targetFormat.toUpperCase()} is not available for ${category} files.`
    };
  }

  if (normSource === normTarget) {
    return {
      isSupported: true,
      isSameFormat: true,
      reason: `Source file is already .${targetFormat.toUpperCase()}. Conversion intent recorded without overwrite.`,
      targetFormat: normTarget
    };
  }

  return {
    isSupported: true,
    isSameFormat: false,
    targetFormat: normTarget
  };
}
