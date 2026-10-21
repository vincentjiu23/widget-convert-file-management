import { describe, it, expect } from 'vitest';
import {
  radialStateReducer,
  INITIAL_STATE_CONTEXT
} from '../src/renderer/src/core/RadialStateMachine';
import { ClassifiedFile, RadialSector } from '../src/shared/types';

describe('RadialStateMachine Transition Suite', () => {
  const dummyImageFile: ClassifiedFile = {
    name: 'photo.jpg',
    path: 'C:\\Users\\User\\Pictures\\photo.jpg',
    extension: 'jpg',
    category: 'image',
    sizeBytes: 1024
  };

  const dummySector: RadialSector = {
    id: 'img-png',
    label: 'PNG',
    format: 'png',
    description: 'Lossless with Alpha',
    category: 'image',
    accentColor: '#38bdf8'
  };

  it('starts in IDLE state', () => {
    expect(INITIAL_STATE_CONTEXT.state).toBe('IDLE');
    expect(INITIAL_STATE_CONTEXT.activeFile).toBeNull();
  });

  it('transitions from IDLE to FILE_HOVER on DRAG_ENTER', () => {
    const s1 = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyImageFile
    });
    expect(s1.state).toBe('FILE_HOVER');
    expect(s1.activeFile?.name).toBe('photo.jpg');
  });

  it('transitions to FORMAT_RING_VISIBLE when valid category detected', () => {
    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyImageFile
    });
    s = radialStateReducer(s, {
      type: 'TYPE_DETECTED',
      category: 'image'
    });
    expect(s.state).toBe('FORMAT_RING_VISIBLE');
    expect(s.errorMessage).toBeNull();
  });

  it('transitions to ERROR when unsupported category detected', () => {
    const dummyUnknown: ClassifiedFile = {
      name: 'archive.zip',
      path: 'C:\\archive.zip',
      extension: 'zip',
      category: 'unknown'
    };
    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyUnknown
    });
    s = radialStateReducer(s, {
      type: 'TYPE_DETECTED',
      category: 'unknown'
    });
    expect(s.state).toBe('ERROR');
    expect(s.errorMessage).toContain('Format not supported');
  });

  it('updates hovered sector state during SECTOR_HOVER without creating a job', () => {
    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyImageFile
    });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'image' });
    s = radialStateReducer(s, {
      type: 'SECTOR_HOVER',
      sectorIndex: 0,
      sector: dummySector
    });

    expect(s.state).toBe('SECTOR_HOVER');
    expect(s.hoveredSectorIndex).toBe(0);
    expect(s.selectedSector?.format).toBe('png');
    // Hover alone MUST NOT create an activeJobId
    expect(s.activeJobId).toBeNull();
  });

  it('creates job on DROP_ON_SECTOR for valid target', () => {
    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyImageFile
    });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'image' });
    s = radialStateReducer(s, {
      type: 'DROP_ON_SECTOR',
      sector: dummySector
    });

    expect(s.state).toBe('JOB_QUEUED');
    expect(s.selectedSector?.format).toBe('png');
  });

  it('safely cancels back to IDLE on DROP_OUTSIDE or CANCEL_ESCAPE', () => {
    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyImageFile
    });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'image' });

    // Drop outside
    const sCancelled = radialStateReducer(s, { type: 'DROP_OUTSIDE' });
    expect(sCancelled.state).toBe('IDLE');
    expect(sCancelled.activeFile).toBeNull();

    // Escape key
    const sEscaped = radialStateReducer(s, { type: 'CANCEL_ESCAPE' });
    expect(sEscaped.state).toBe('IDLE');
  });

  it('handles job lifecycle: QUEUED -> PROCESSING -> SUCCESS', () => {
    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: dummyImageFile
    });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'image' });
    s = radialStateReducer(s, { type: 'DROP_ON_SECTOR', sector: dummySector });

    s = radialStateReducer(s, { type: 'JOB_STARTED', jobId: 'job-123' });
    expect(s.state).toBe('PROCESSING');
    expect(s.activeJobId).toBe('job-123');

    s = radialStateReducer(s, {
      type: 'JOB_COMPLETED',
      outputPath: 'C:\\Users\\User\\Pictures\\photo.png'
    });
    expect(s.state).toBe('SUCCESS');
    expect(s.successMessage).toContain('photo.png');
  });
});
