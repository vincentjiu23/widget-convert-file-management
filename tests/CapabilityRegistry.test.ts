import { describe, it, expect } from 'vitest';
import {
  getCompatibleSectors,
  validateConversionCompatibility,
  CAPABILITY_SECTORS
} from '../src/renderer/src/core/CapabilityRegistry';

describe('CapabilityRegistry Validation Suite', () => {
  it('returns valid sector configurations for image category', () => {
    const sectors = getCompatibleSectors('image');
    expect(sectors.length).toBe(4);
    const formats = sectors.map(s => s.format);
    expect(formats).toEqual(['png', 'jpg', 'webp', 'bmp']);
  });

  it('returns valid sector configurations for video category', () => {
    const sectors = getCompatibleSectors('video');
    expect(sectors.length).toBe(2);
    const formats = sectors.map(s => s.format);
    expect(formats).toEqual(['mp4', 'webm']);
  });

  it('returns valid sector configurations for document category', () => {
    const sectors = getCompatibleSectors('document');
    expect(sectors.length).toBe(3);
    const formats = sectors.map(s => s.format);
    expect(formats).toEqual(['pdf', 'docx', 'txt']);
  });

  it('returns empty sectors for unknown category', () => {
    const sectors = getCompatibleSectors('unknown');
    expect(sectors.length).toBe(0);
  });

  it('validates valid cross-format conversions correctly', () => {
    const check = validateConversionCompatibility('png', 'webp', 'image');
    expect(check.isSupported).toBe(true);
    expect(check.isSameFormat).toBe(false);
    expect(check.targetFormat).toBe('webp');
  });

  it('identifies same-format conversions and provides safe explanation', () => {
    const check = validateConversionCompatibility('png', 'png', 'image');
    expect(check.isSupported).toBe(true);
    expect(check.isSameFormat).toBe(true);
    expect(check.reason).toContain('Source file is already');
  });

  it('rejects unsupported categories', () => {
    const check = validateConversionCompatibility('exe', 'png', 'unknown');
    expect(check.isSupported).toBe(false);
    expect(check.reason).toContain('drop the file onto the primary circle');
  });
});
