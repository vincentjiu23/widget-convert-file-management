import { describe, it, expect } from 'vitest';
import {
  extractExtension,
  detectFileCategory,
  classifyFile,
  classifyMultipleFiles
} from '../src/renderer/src/core/FileClassifier';

describe('FileClassifier Detection Suite', () => {
  it('extracts extensions accurately from filenames and paths', () => {
    expect(extractExtension('photo.png')).toBe('png');
    expect(extractExtension('C:\\Users\\User\\Documents\\report.final.docx')).toBe('docx');
    expect(extractExtension('video.MP4')).toBe('mp4');
    expect(extractExtension('noextension')).toBe('');
  });

  it('detects image categories properly', () => {
    expect(detectFileCategory('png')).toBe('image');
    expect(detectFileCategory('jpg')).toBe('image');
    expect(detectFileCategory('jpeg')).toBe('image');
    expect(detectFileCategory('webp')).toBe('image');
    expect(detectFileCategory('bmp')).toBe('image');
    expect(detectFileCategory('gif')).toBe('image');
    expect(detectFileCategory('svg')).toBe('image');
  });

  it('detects video categories properly', () => {
    expect(detectFileCategory('mp4')).toBe('video');
    expect(detectFileCategory('webm')).toBe('video');
    expect(detectFileCategory('mov')).toBe('video');
    expect(detectFileCategory('mkv')).toBe('video');
    expect(detectFileCategory('avi')).toBe('video');
  });

  it('detects document categories properly', () => {
    expect(detectFileCategory('pdf')).toBe('document');
    expect(detectFileCategory('docx')).toBe('document');
    expect(detectFileCategory('txt')).toBe('document');
    expect(detectFileCategory('xlsx')).toBe('document');
    expect(detectFileCategory('pptx')).toBe('document');
  });

  it('flags unsupported formats as unknown', () => {
    expect(detectFileCategory('exe')).toBe('unknown');
    expect(detectFileCategory('zip')).toBe('unknown');
    expect(detectFileCategory('iso')).toBe('unknown');
    expect(detectFileCategory('dll')).toBe('unknown');
  });

  it('classifies multiple files and identifies homogeneity', () => {
    const images = [
      { name: 'pic1.png', size: 1024 },
      { name: 'pic2.jpg', size: 2048 },
      { name: 'pic3.webp', size: 4096 }
    ];
    const resImages = classifyMultipleFiles(images);
    expect(resImages.totalFiles).toBe(3);
    expect(resImages.dominantCategory).toBe('image');
    expect(resImages.isHomogeneous).toBe(true);
    expect(resImages.unsupportedCount).toBe(0);

    const mixed = [
      { name: 'pic1.png', size: 1024 },
      { name: 'movie.mp4', size: 204800 },
      { name: 'unknown.xyz', size: 500 }
    ];
    const resMixed = classifyMultipleFiles(mixed);
    expect(resMixed.isHomogeneous).toBe(false);
    expect(resMixed.unsupportedCount).toBe(1);
  });
});
