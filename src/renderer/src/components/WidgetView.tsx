import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  StateMachineContext,
  StateMachineAction,
  radialStateReducer,
  INITIAL_STATE_CONTEXT
} from '../core/RadialStateMachine';
import {
  getCompatibleSectors,
  validateConversionCompatibility
} from '../core/CapabilityRegistry';
import {
  getRadialSectorHit,
  polarToCartesian,
  generateArcSvgPath
} from '../core/RadialGeometry';
import {
  classifyFile,
  detectFileCategory
} from '../core/FileClassifier';
import {
  FileCategory,
  RadialSector
} from '../../../shared/types';
import {
  GripHorizontal,
  X,
  ExternalLink,
  Sparkles,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  FolderOpen
} from 'lucide-react';

const CANVAS_SIZE = 380;
const CENTER = CANVAS_SIZE / 2;
const R_INNER = 70;
const R_OUTER = 160;

export const WidgetView: React.FC = () => {
  const [context, dispatch] = React.useReducer(radialStateReducer, INITIAL_STATE_CONTEXT);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCategory: FileCategory = context.activeFile?.category || 'unknown';
  const sectors = getCompatibleSectors(activeCategory);
  const isRingExpanded =
    (context.state === 'FORMAT_RING_VISIBLE' || context.state === 'SECTOR_HOVER') &&
    sectors.length > 0;

  /**
   * Robust file path resolver:
   * Extracts real absolute filesystem path via Electron webUtils.
   * Never returns file.name as a pseudo-path.
   */
  const resolveFilePath = useCallback((file: File): string => {
    if (window.radialAPI?.getPathForFile) {
      try {
        const p = window.radialAPI.getPathForFile(file);
        if (p && typeof p === 'string' && (p.includes('\\') || p.includes('/'))) {
          return p.trim();
        }
      } catch {
        // webUtils resolution failed
      }
    }

    const legacyPath = (file as unknown as { path?: string }).path;
    if (legacyPath && typeof legacyPath === 'string' && (legacyPath.includes('\\') || legacyPath.includes('/'))) {
      return legacyPath.trim();
    }

    return '';
  }, []);

  /**
   * Click-through and selective interaction manager:
   * Passes clicks through transparent areas outside the interactive widget geometry.
   * Keeps center circle, radial sectors, header drag bar, and action buttons responsive.
   */
  useEffect(() => {
    let isIgnoring = false;

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | SVGElement | null;
      if (!target) return;

      const isInteractive = Boolean(
        target.closest('.primary-circle') ||
        target.closest('.widget-drag-bar') ||
        target.closest('.radial-sector-path') ||
        target.closest('.widget-action-btn') ||
        target.closest('.btn-glass') ||
        target.closest('.widget-no-drag') ||
        target.closest('.widget-error-pill')
      );

      if (isInteractive && isIgnoring) {
        window.radialAPI?.setIgnoreMouseEvents(false);
        isIgnoring = false;
      } else if (!isInteractive && !isIgnoring) {
        window.radialAPI?.setIgnoreMouseEvents(true, true);
        isIgnoring = true;
      }
    };

    const handleMouseLeave = () => {
      if (!isIgnoring) {
        window.radialAPI?.setIgnoreMouseEvents(true, true);
        isIgnoring = true;
      }
    };

    const handleWindowBlur = () => {
      if (!isIgnoring) {
        window.radialAPI?.setIgnoreMouseEvents(true, true);
        isIgnoring = true;
      }
    };

    // When dragging OS files into the window, drag events fire instead of mousemove.
    // Ensure mouse events are NEVER ignored during dragover so drop targets work reliably.
    const handleDragEnter = () => {
      if (isIgnoring) {
        window.radialAPI?.setIgnoreMouseEvents(false);
        isIgnoring = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragEnter);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragEnter);
      window.radialAPI?.setIgnoreMouseEvents(false);
    };
  }, []);

  const handleOpenDashboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.radialAPI?.openDashboardWindow) {
      window.radialAPI.openDashboardWindow();
    }
  };

  const handleCloseWidget = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.radialAPI?.toggleDesktopWidget) {
      window.radialAPI.toggleDesktopWidget(false);
    }
  };

  /**
   * Primary conversion execution pipeline:
   * Validates path, calls convertFile, logs progress, and manages UI state.
   */
  const executeConversion = async (sourcePath: string, sector: RadialSector) => {
    if (!sourcePath || (!sourcePath.includes('/') && !sourcePath.includes('\\'))) {
      dispatch({
        type: 'JOB_FAILED',
        error: 'Invalid file path. Please select the file using the file picker.'
      });
      return;
    }

    const jobId = `job-${Date.now()}`;
    dispatch({ type: 'JOB_STARTED', jobId });
    setShowErrorDetail(false);

    try {
      if (!window.radialAPI?.convertFile) {
        throw new Error('Conversion API unavailable.');
      }

      const result = await window.radialAPI.convertFile(sourcePath, sector.format);
      if (result.success && result.outputPath) {
        const outName = result.outputPath.split(/[/\\]/).pop();
        dispatch({
          type: 'JOB_COMPLETED',
          outputPath: result.outputPath,
          message: `Converted to .${sector.format.toUpperCase()}: ${outName}`
        });
      } else {
        const errorText =
          result.error ||
          (result.status === 'UNSUPPORTED'
            ? `Conversion to .${sector.format.toUpperCase()} is not supported.`
            : 'Conversion failed.');
        dispatch({
          type: 'JOB_FAILED',
          error: errorText
        });
      }
    } catch (err: unknown) {
      dispatch({
        type: 'JOB_FAILED',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };

  /**
   * Safe native file picker invocation:
   * Uses native Windows file dialog to guarantee an absolute, valid filesystem path.
   */
  const handleOpenNativeFilePicker = async () => {
    if (window.radialAPI?.openFilePicker) {
      try {
        const selectedPath = await window.radialAPI.openFilePicker();
        if (selectedPath && typeof selectedPath === 'string' && selectedPath.trim()) {
          const cleanPath = selectedPath.trim();
          const fileName = cleanPath.split(/[/\\]/).pop() || cleanPath;
          const classified = classifyFile({
            name: fileName,
            path: cleanPath
          });
          dispatch({ type: 'DRAG_ENTER', file: classified });
          dispatch({ type: 'TYPE_DETECTED', category: classified.category });
          setShowErrorDetail(false);
          return;
        }
      } catch (err) {
        console.warn('[WidgetView] Native file picker error:', err);
      }
    }

    // Fallback to HTML file input if native picker is unavailable
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (sectors.length > 0) {
      const hit = getRadialSectorHit(x, y, CENTER, CENTER, R_INNER, R_OUTER, sectors.length);

      if (hit.isInsideRing && hit.sectorIndex >= 0 && hit.sectorIndex < sectors.length) {
        if (context.hoveredSectorIndex !== hit.sectorIndex) {
          dispatch({
            type: 'SECTOR_HOVER',
            sectorIndex: hit.sectorIndex,
            sector: sectors[hit.sectorIndex]
          });
        }
      } else if (hit.isInsideCenter || hit.isOutside) {
        if (context.state === 'SECTOR_HOVER') {
          dispatch({ type: 'SECTOR_LEAVE' });
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    if (!containerRef.current || e.dataTransfer.files.length === 0) {
      dispatch({ type: 'DROP_OUTSIDE' });
      return;
    }

    const file = e.dataTransfer.files[0];
    const resolvedPath = resolveFilePath(file);

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (sectors.length > 0) {
      const hit = getRadialSectorHit(x, y, CENTER, CENTER, R_INNER, R_OUTER, sectors.length);

      if (hit.isInsideRing && hit.sectorIndex >= 0 && hit.sectorIndex < sectors.length) {
        const sector = sectors[hit.sectorIndex];
        dispatch({ type: 'DROP_ON_SECTOR', sector });

        if (resolvedPath) {
          executeConversion(resolvedPath, sector);
        } else if (context.activeFile?.path) {
          executeConversion(context.activeFile.path, sector);
        } else {
          dispatch({
            type: 'JOB_FAILED',
            error: 'File path unavailable from browser drop. Please click the center to select the file directly.'
          });
        }
        return;
      }
    }

    // Dropped onto center circle: detect category and retain resolved path
    if (resolvedPath) {
      const classified = classifyFile({
        name: file.name,
        path: resolvedPath,
        type: file.type,
        size: file.size
      });
      dispatch({ type: 'DRAG_ENTER', file: classified });
      dispatch({ type: 'TYPE_DETECTED', category: classified.category });
      setShowErrorDetail(false);
    } else {
      dispatch({
        type: 'JOB_FAILED',
        error: 'Cannot read file path from drop. Please click the center circle to select your file directly.'
      });
    }
  };

  return (
    <div
      className="widget-window-container"
      ref={containerRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Sleek Translucent Drag Bar Header */}
      <div className="widget-drag-bar">
        <GripHorizontal size={14} color="#f97316" />
        <span>Radial File Studio</span>
        <button
          className="widget-no-drag"
          onClick={handleCloseWidget}
          onMouseDown={(e) => e.stopPropagation()}
          title="Hide Widget"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            marginLeft: '4px',
            padding: '2px',
            borderRadius: '4px'
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* SVG Radial Sectors (Translucent Frosted Acrylic) */}
      {isRingExpanded && (
        <svg
          className="radial-svg-canvas"
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
        >
          <defs>
            <filter id="sector-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {sectors.map((sector, index) => {
            const angleStep = 360 / sectors.length;
            const startAngle = index * angleStep - 90;
            const endAngle = (index + 1) * angleStep - 90;
            const isHovered = context.hoveredSectorIndex === index;
            const pathData = generateArcSvgPath(CENTER, CENTER, R_INNER, R_OUTER, startAngle, endAngle);
            const midAngle = (startAngle + endAngle) / 2;
            const labelPos = polarToCartesian(CENTER, CENTER, (R_INNER + R_OUTER) / 2, midAngle);

            return (
              <g
                key={sector.id}
                className="widget-no-drag"
                onClick={() => {
                  if (context.activeFile?.path) {
                    executeConversion(context.activeFile.path, sector);
                  } else {
                    dispatch({
                      type: 'JOB_FAILED',
                      error: 'No active file selected. Click the center circle to choose a file.'
                    });
                  }
                }}
              >
                <path
                  d={pathData}
                  className={`radial-sector-path ${isHovered ? 'is-active' : ''}`}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y + 4}
                  className={`radial-sector-text ${isHovered ? 'is-active' : ''}`}
                >
                  .{sector.format.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {/* Central Primary Circle (Frosted Transparent Acrylic Glass) */}
      <div
        className={`primary-circle widget-no-drag ${context.state === 'FILE_HOVER' ? 'is-dragging' : ''}`}
        onClick={() => {
          if (context.state === 'SUCCESS' || context.state === 'ERROR') {
            dispatch({ type: 'RESET_IDLE' });
            setShowErrorDetail(false);
          } else {
            handleOpenNativeFilePicker();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              const file = e.target.files[0];
              const resolvedPath = resolveFilePath(file);
              const classified = classifyFile({
                name: file.name,
                path: resolvedPath || file.name,
                type: file.type,
                size: file.size
              });
              dispatch({ type: 'DRAG_ENTER', file: classified });
              dispatch({ type: 'TYPE_DETECTED', category: classified.category });
              setShowErrorDetail(false);
            }
          }}
        />

        {context.state === 'PROCESSING' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={26} className="animate-spin" color="#f97316" />
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#ffffff' }}>Converting...</span>
          </div>
        ) : context.state === 'SUCCESS' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
            <CheckCircle size={24} color="#34d399" />
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#34d399' }}>Converted!</span>
            <span
              style={{
                fontSize: '9px',
                color: 'var(--text-secondary)',
                maxWidth: '110px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={context.lastOutputPath || ''}
            >
              {context.lastOutputPath?.split(/[/\\]/).pop() || ''}
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Click to reset</span>
          </div>
        ) : context.state === 'ERROR' ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '0 4px' }}
            onClick={(e) => {
              e.stopPropagation();
              setShowErrorDetail(!showErrorDetail);
            }}
          >
            <AlertTriangle size={22} color="#f87171" />
            <span style={{ fontSize: '10px', fontWeight: '800', color: '#f87171' }}>Conversion Error</span>
            <span
              style={{
                fontSize: '9px',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                maxWidth: '110px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={context.errorMessage || ''}
            >
              {context.errorMessage?.slice(0, 32) || 'Operation failed'}
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Click to dismiss</span>
          </div>
        ) : context.activeFile ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            {context.activeFile.category === 'document' ? (
              <FileText size={22} color="#34d399" />
            ) : (
              <ImageIcon size={22} color="#38bdf8" />
            )}
            <span
              style={{
                fontSize: '11px',
                fontWeight: '800',
                maxWidth: '105px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#ffffff'
              }}
              title={context.activeFile.name}
            >
              {context.activeFile.name}
            </span>
            <span style={{ fontSize: '9px', color: '#f97316', fontWeight: '700' }}>
              Select target format
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={24} color="#f97316" />
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#ffffff' }}>Drop File</span>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>or click to browse</span>
          </div>
        )}
      </div>

      {/* Structured Compact Error Pill (if opened or active error) */}
      {context.state === 'ERROR' && showErrorDetail && context.errorMessage && (
        <div
          className="widget-error-pill widget-no-drag"
          onClick={() => setShowErrorDetail(false)}
          title="Click to dismiss"
        >
          <AlertTriangle size={14} color="#f87171" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '10px', color: '#ffffff', lineHeight: 1.3 }}>
            {context.errorMessage}
          </span>
          <X size={12} color="var(--text-muted)" style={{ cursor: 'pointer', marginLeft: 'auto', flexShrink: 0 }} />
        </div>
      )}

      {/* Bottom Floating Action: Open Dashboard */}
      <button
        className="widget-action-btn widget-no-drag"
        onClick={handleOpenDashboard}
        onMouseDown={(e) => e.stopPropagation()}
        title="Open Full Application Dashboard"
      >
        <ExternalLink size={12} color="#f97316" />
        <span>Open Dashboard</span>
      </button>
    </div>
  );
};
