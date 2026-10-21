import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  detectFileCategory,
  extractExtension
} from '../src/renderer/src/core/FileClassifier';
import {
  getCompatibleSectors,
  validateConversionCompatibility
} from '../src/renderer/src/core/CapabilityRegistry';

describe('Task B: External Drag-and-Drop & MIME Robustness Suite', () => {
  it('correctly classifies standard formats with or without MIME', () => {
    // 1. PNG
    const pngWithMime = classifyFile({ name: 'photo.png', type: 'image/png' });
    expect(pngWithMime.category).toBe('image');
    expect(pngWithMime.isMimePending).toBe(false);

    const pngWithoutMime = classifyFile({ name: 'photo.png', type: '' });
    expect(pngWithoutMime.category).toBe('image');

    // 2. MP4
    const mp4WithMime = classifyFile({ name: 'clip.mp4', type: 'video/mp4' });
    expect(mp4WithMime.category).toBe('video');

    const mp4WithoutMime = classifyFile({ name: 'clip.mp4', type: '' });
    expect(mp4WithoutMime.category).toBe('video');

    // 3. PDF
    const pdfWithMime = classifyFile({ name: 'doc.pdf', type: 'application/pdf' });
    expect(pdfWithMime.category).toBe('document');

    const pdfWithoutMime = classifyFile({ name: 'doc.pdf', type: '' });
    expect(pdfWithoutMime.category).toBe('document');

    // 4. DOCX
    const docxWithoutMime = classifyFile({ name: 'resume.docx', type: '' });
    expect(docxWithoutMime.category).toBe('document');
  });

  it('handles empty MIME and hidden filename during Windows Explorer dragover (fallback)', () => {
    // During dragover from Explorer before drop, name is generic and type is empty
    const explorerDragItem = classifyFile({ name: 'Explorer File', type: '' });
    expect(explorerDragItem.category).toBe('generic_file');
    expect(explorerDragItem.isMimePending).toBe(true);

    // Universal format ring provides primary targets across all categories
    const universalSectors = getCompatibleSectors('generic_file');
    expect(universalSectors.length).toBeGreaterThanOrEqual(4);
    const formats = universalSectors.map((s) => s.format);
    expect(formats).toContain('png');
    expect(formats).toContain('mp4');
    expect(formats).toContain('pdf');
  });

  it('validates drop compatibility when source was generic during drag but revealed on drop', () => {
    // User dragged unknown file and dropped onto 'pdf' sector
    // Upon drop, the actual file is revealed to be 'report.docx'
    const docDropCheck = validateConversionCompatibility('docx', 'pdf', 'generic_file');
    expect(docDropCheck.isSupported).toBe(true);
    expect(docDropCheck.targetFormat).toBe('pdf');

    // User dragged unknown file and dropped onto 'pdf' sector
    // But actual file is revealed to be 'clip.mp4' (incompatible video -> pdf)
    const videoDropCheck = validateConversionCompatibility('mp4', 'pdf', 'generic_file');
    expect(videoDropCheck.isSupported).toBe(false);
    expect(videoDropCheck.reason).toContain('Target format .PDF is not compatible with video files');
  });

  it('flags known unsupported file types (exe, zip, dll) explicitly', () => {
    expect(detectFileCategory('exe')).toBe('unknown');
    expect(detectFileCategory('zip')).toBe('unknown');
    expect(detectFileCategory('dll')).toBe('unknown');

    const exeCheck = validateConversionCompatibility('exe', 'png', 'unknown');
    expect(exeCheck.isSupported).toBe(false);
    expect(exeCheck.reason).toContain('not currently supported');
  });
});
