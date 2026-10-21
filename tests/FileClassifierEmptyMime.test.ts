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

  it('returns EMPTY sectors for generic_file (gate fix: no fake universal ring)', () => {
    // Gate requirement: When MIME is hidden during Explorer dragover, do NOT show a
    // fake universal format list. Show a neutral drop hint instead.
    const neutralSectors = getCompatibleSectors('generic_file');
    expect(neutralSectors.length).toBe(0);
    // Ring should only appear after file identity is resolved upon actual drop
  });

  it('blocks conversion when category is still generic_file (must resolve via drop first)', () => {
    // generic_file means identity is not yet resolved — conversion must be blocked
    const docDropCheck = validateConversionCompatibility('docx', 'pdf', 'generic_file');
    expect(docDropCheck.isSupported).toBe(false);
    expect(docDropCheck.reason).toContain('drop the file onto the primary circle');

    // After resolving to actual category 'document', conversion is valid
    const resolvedCheck = validateConversionCompatibility('docx', 'pdf', 'document');
    expect(resolvedCheck.isSupported).toBe(true);
    expect(resolvedCheck.targetFormat).toBe('pdf');
  });

  it('flags known unsupported file types (exe, zip, dll) explicitly', () => {
    expect(detectFileCategory('exe')).toBe('unknown');
    expect(detectFileCategory('zip')).toBe('unknown');
    expect(detectFileCategory('dll')).toBe('unknown');

    const exeCheck = validateConversionCompatibility('exe', 'png', 'unknown');
    expect(exeCheck.isSupported).toBe(false);
    expect(exeCheck.reason).toContain('drop the file onto the primary circle');
  });
});
