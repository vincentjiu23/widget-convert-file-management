import { RadialInteractionState, FileCategory, ClassifiedFile, RadialSector } from '../../../shared/types';
import { validateConversionCompatibility } from './CapabilityRegistry';

export interface StateMachineContext {
  state: RadialInteractionState;
  activeFile: ClassifiedFile | null;
  selectedSector: RadialSector | null;
  hoveredSectorIndex: number;
  errorMessage: string | null;
  successMessage: string | null;
  activeJobId: string | null;
}

export type StateMachineAction =
  | { type: 'DRAG_ENTER'; file: ClassifiedFile }
  | { type: 'TYPE_DETECTED'; category: FileCategory }
  | { type: 'EXPAND_RING' }
  | { type: 'SECTOR_HOVER'; sectorIndex: number; sector: RadialSector }
  | { type: 'SECTOR_LEAVE' }
  | { type: 'DROP_ON_SECTOR'; sector: RadialSector }
  | { type: 'DROP_OUTSIDE' }
  | { type: 'CANCEL_ESCAPE' }
  | { type: 'JOB_STARTED'; jobId: string }
  | { type: 'JOB_COMPLETED'; outputPath: string }
  | { type: 'JOB_FAILED'; error: string }
  | { type: 'RESET_IDLE' };

export const INITIAL_STATE_CONTEXT: StateMachineContext = {
  state: 'IDLE',
  activeFile: null,
  selectedSector: null,
  hoveredSectorIndex: -1,
  errorMessage: null,
  successMessage: null,
  activeJobId: null
};

export function radialStateReducer(
  current: StateMachineContext,
  action: StateMachineAction
): StateMachineContext {
  switch (action.type) {
    case 'DRAG_ENTER':
      return {
        ...current,
        state: 'FILE_HOVER',
        activeFile: action.file,
        selectedSector: null,
        hoveredSectorIndex: -1,
        errorMessage: null,
        successMessage: null
      };

    case 'TYPE_DETECTED':
      return {
        ...current,
        state: action.category === 'unknown' ? 'ERROR' : 'FORMAT_RING_VISIBLE',
        errorMessage:
          action.category === 'unknown'
            ? 'Format not supported. Radial File Studio accepts Images, Videos, and Documents.'
            : null
      };

    case 'EXPAND_RING':
      if (current.activeFile && current.activeFile.category !== 'unknown') {
        return {
          ...current,
          state: 'FORMAT_RING_VISIBLE'
        };
      }
      return current;

    case 'SECTOR_HOVER':
      return {
        ...current,
        state: 'SECTOR_HOVER',
        hoveredSectorIndex: action.sectorIndex,
        selectedSector: action.sector
      };

    case 'SECTOR_LEAVE':
      return {
        ...current,
        state: current.activeFile ? 'FORMAT_RING_VISIBLE' : 'IDLE',
        hoveredSectorIndex: -1,
        selectedSector: null
      };

    case 'DROP_ON_SECTOR': {
      if (!current.activeFile) {
        return {
          ...current,
          state: 'IDLE'
        };
      }

      const validation = validateConversionCompatibility(
        current.activeFile.extension,
        action.sector.format,
        current.activeFile.category
      );

      if (!validation.isSupported) {
        return {
          ...current,
          state: 'ERROR',
          errorMessage: validation.reason || 'Conversion target not supported.'
        };
      }

      return {
        ...current,
        state: 'JOB_QUEUED',
        selectedSector: action.sector,
        errorMessage: null
      };
    }

    case 'DROP_OUTSIDE':
    case 'CANCEL_ESCAPE':
      return {
        ...INITIAL_STATE_CONTEXT
      };

    case 'JOB_STARTED':
      return {
        ...current,
        state: 'PROCESSING',
        activeJobId: action.jobId
      };

    case 'JOB_COMPLETED':
      return {
        ...current,
        state: 'SUCCESS',
        successMessage: `Saved to ${action.outputPath}`,
        activeJobId: null
      };

    case 'JOB_FAILED':
      return {
        ...current,
        state: 'ERROR',
        errorMessage: action.error,
        activeJobId: null
      };

    case 'RESET_IDLE':
      return {
        ...INITIAL_STATE_CONTEXT
      };

    default:
      return current;
  }
}
