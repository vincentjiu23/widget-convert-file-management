import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  radialStateReducer,
  INITIAL_STATE_CONTEXT,
  StateMachineContext
} from '../src/renderer/src/core/RadialStateMachine';
import { ClassifiedFile, RadialSector } from '../src/shared/types';
import { getCompatibleSectors } from '../src/renderer/src/core/CapabilityRegistry';

/**
 * Conversion Preview State Tests
 * Gate requirement: No false SUCCEEDED states. No fake output paths.
 * Tests that the state machine and App-level flow only produce PREVIEW_RECORDED.
 */
describe('Gate: Prevention of False SUCCEEDED Conversion States', () => {
  const imageFile: ClassifiedFile = {
    name: 'photo.jpg',
    path: 'C:\\Users\\User\\Pictures\\photo.jpg',
    extension: 'jpg',
    category: 'image',
    sizeBytes: 2048
  };

  const pngSector: RadialSector = {
    id: 'img-png',
    label: 'PNG',
    format: 'png',
    description: 'Lossless with Alpha',
    category: 'image',
    accentColor: '#38bdf8'
  };

  it('state machine has no SUCCESS-producing action type', () => {
    // Walk through every possible action and confirm none produce SUCCESS
    let s: StateMachineContext = INITIAL_STATE_CONTEXT;
    s = radialStateReducer(s, { type: 'DRAG_ENTER', file: imageFile });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'image' });
    s = radialStateReducer(s, { type: 'DROP_ON_SECTOR', sector: pngSector });
    s = radialStateReducer(s, { type: 'JOB_STARTED', jobId: 'j-1' });
    
    // The only completion action is RECORD_CONVERSION_PREVIEW
    s = radialStateReducer(s, {
      type: 'RECORD_CONVERSION_PREVIEW',
      targetFormat: 'png',
      note: 'Preview registered'
    });
    expect(s.state).toBe('PREVIEW_RECORDED');
    expect(s.state).not.toBe('SUCCESS');
  });

  it('RECORD_CONVERSION_PREVIEW clears activeJobId', () => {
    let s = INITIAL_STATE_CONTEXT;
    s = radialStateReducer(s, { type: 'DRAG_ENTER', file: imageFile });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'image' });
    s = radialStateReducer(s, { type: 'DROP_ON_SECTOR', sector: pngSector });
    s = radialStateReducer(s, { type: 'JOB_STARTED', jobId: 'j-2' });
    expect(s.activeJobId).toBe('j-2');
    
    s = radialStateReducer(s, {
      type: 'RECORD_CONVERSION_PREVIEW',
      targetFormat: 'png',
      note: 'Engine inactive'
    });
    expect(s.activeJobId).toBeNull();
  });

  it('App.tsx no longer contains setTimeout with SUCCEEDED', () => {
    const appSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.tsx'),
      'utf-8'
    );
    // Must not contain the old timer pattern
    expect(appSource).not.toContain("status: 'SUCCEEDED'");
    expect(appSource).not.toContain("status: 'RUNNING'");
    // Must contain the new pattern
    expect(appSource).toContain("status: 'PREVIEW_RECORDED'");
    expect(appSource).toContain('engineMessage');
    expect(appSource).toContain('RECORD_CONVERSION_PREVIEW');
  });

  it('ConversionJob type includes PREVIEW_RECORDED status', () => {
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'shared', 'types.ts'),
      'utf-8'
    );
    expect(typesSource).toContain("'PREVIEW_RECORDED'");
    expect(typesSource).toContain('engineMessage');
  });

  it('DashboardModal renders PREVIEW_RECORDED with amber styling, not green', () => {
    const dashSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'DashboardModal.tsx'),
      'utf-8'
    );
    // Must handle PREVIEW_RECORDED in status badge
    expect(dashSource).toContain('PREVIEW_RECORDED');
    // Must display engine disclaimer
    expect(dashSource).toContain('engineMessage');
    // Reveal button only shown for SUCCEEDED (real output), not for PREVIEW_RECORDED
    expect(dashSource).toContain("job.status === 'SUCCEEDED' && job.outputPath");
  });
});

describe('Gate: Empty-MIME Drag Neutral Hint', () => {
  it('generic_file category has NO conversion formats in CapabilityRegistry', () => {
    const formats = getCompatibleSectors('generic_file');
    expect(formats).toEqual([]);
  });

  it('TYPE_DETECTED with generic_file stays in FILE_HOVER, no ring expansion', () => {
    const genericFile: ClassifiedFile = {
      name: 'dragged-item',
      path: '',
      extension: '',
      category: 'generic_file',
      isMimePending: true
    };

    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: genericFile
    });
    s = radialStateReducer(s, { type: 'TYPE_DETECTED', category: 'generic_file' });
    
    // Must remain in FILE_HOVER, NOT FORMAT_RING_VISIBLE
    expect(s.state).toBe('FILE_HOVER');
    expect(s.errorMessage).toBeNull();
  });

  it('EXPAND_RING is blocked when file is generic_file', () => {
    const genericFile: ClassifiedFile = {
      name: 'dragged-item',
      path: '',
      extension: '',
      category: 'generic_file',
      isMimePending: true
    };

    let s = radialStateReducer(INITIAL_STATE_CONTEXT, {
      type: 'DRAG_ENTER',
      file: genericFile
    });
    s = radialStateReducer(s, { type: 'EXPAND_RING' });

    // generic_file must NOT expand ring
    expect(s.state).not.toBe('FORMAT_RING_VISIBLE');
  });

  it('RadialWidget shows neutral drop hint text for generic_file', () => {
    const widgetSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'RadialWidget.tsx'),
      'utf-8'
    );
    expect(widgetSource).toContain('Drop in center');
    expect(widgetSource).toContain('generic_file');
  });
});
