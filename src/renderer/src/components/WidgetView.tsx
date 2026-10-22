import React, { useRef, useState, useEffect } from 'react';
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
  Image as ImageIcon
} from 'lucide-react';

const CANVAS_SIZE = 380;
const CENTER = CANVAS_SIZE / 2;
const R_INNER = 70;
const R_OUTER = 160;

export const WidgetView: React.FC = () => {
  const [context, dispatch] = React.useReducer(radialStateReducer, INITIAL_STATE_CONTEXT);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCategory: FileCategory = context.activeFile?.category || 'unknown';
  const sectors = getCompatibleSectors(activeCategory);
  const isRingExpanded =
    (context.state === 'FORMAT_RING_VISIBLE' || context.state === 'SECTOR_HOVER') &&
    sectors.length > 0;

  // Prevent frameless transparent window from stealing clicks from desktop & background windows
  useEffect(() => {
    let isIgnoring = false;

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | SVGElement | null;
      if (!target) return;

      const isInteractive = Boolean(
        target.closest('.primary-circle') ||
        target.closest('.widget-drag-bar') ||
        target.closest('.radial-svg-canvas') ||
        target.closest('.btn-glass') ||
        target.closest('.widget-no-drag')
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

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.radialAPI?.setIgnoreMouseEvents(false);
    };
  }, []);

  const handleOpenDashboard = () => {
    if (window.radialAPI?.openDashboardWindow) {
      window.radialAPI.openDashboardWindow();
    }
  };

  const handleCloseWidget = () => {
    if (window.radialAPI?.toggleDesktopWidget) {
      window.radialAPI.toggleDesktopWidget(false);
    }
  };

  const handleExecuteDrop = async (file: File, sector: RadialSector) => {
    const rawPath = window.radialAPI?.getPathForFile(file) || file.name;
    const jobId = `job-${Date.now()}`;

    dispatch({ type: 'JOB_STARTED', jobId });

    try {
      if (!window.radialAPI?.convertFile) {
        throw new Error('Conversion API unavailable.');
      }

      const result = await window.radialAPI.convertFile(rawPath, sector.format);
      if (result.success && result.outputPath) {
        dispatch({
          type: 'JOB_COMPLETED',
          outputPath: result.outputPath,
          message: `Converted to .${sector.format.toUpperCase()}: ${result.outputPath.split(/[/\\]/).pop()}`
        });
      } else {
        dispatch({
          type: 'JOB_FAILED',
          error: result.error || 'Conversion failed.'
        });
      }
    } catch (err: unknown) {
      dispatch({
        type: 'JOB_FAILED',
        error: err instanceof Error ? err.message : String(err)
      });
    }
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
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (sectors.length > 0) {
      const hit = getRadialSectorHit(x, y, CENTER, CENTER, R_INNER, R_OUTER, sectors.length);

      if (hit.isInsideRing && hit.sectorIndex >= 0 && hit.sectorIndex < sectors.length) {
        const sector = sectors[hit.sectorIndex];
        dispatch({ type: 'DROP_ON_SECTOR', sector });
        handleExecuteDrop(file, sector);
        return;
      }
    }

    // Dropped onto center circle: detect category
    const classified = classifyFile(file);
    dispatch({ type: 'DRAG_ENTER', file: classified });
    dispatch({ type: 'TYPE_DETECTED', category: classified.category });
  };

  return (
    <div className="widget-window-container" ref={containerRef} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Dedicated Drag Bar Header */}
      <div className="widget-drag-bar">
        <GripHorizontal size={14} color="#f97316" />
        <span>Radial File Studio</span>
        <button
          className="widget-no-drag"
          onClick={handleCloseWidget}
          title="Hide Widget"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            marginLeft: '4px'
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* SVG Radial Sectors */}
      {isRingExpanded && (
        <svg
          className="radial-svg-canvas widget-no-drag"
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
        >
          <defs>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
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
                onClick={() => {
                  if (context.activeFile) {
                    const synth = new File([''], context.activeFile.name);
                    handleExecuteDrop(synth, sector);
                  }
                }}
              >
                <path
                  d={pathData}
                  className={`radial-sector-path ${isHovered ? 'is-active' : ''}`}
                  style={{
                    fill: isHovered ? 'rgba(249, 115, 22, 0.35)' : 'rgba(18, 26, 47, 0.85)',
                    stroke: isHovered ? '#f97316' : 'rgba(255, 255, 255, 0.16)'
                  }}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y + 4}
                  fill={isHovered ? '#f97316' : '#f8fafc'}
                  fontSize="11"
                  fontWeight="800"
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  .{sector.format.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {/* Central Primary Circle */}
      <div
        className={`primary-circle widget-no-drag ${context.state === 'FILE_HOVER' ? 'is-dragging' : ''}`}
        onClick={() => {
          if (context.state === 'SUCCESS' || context.state === 'ERROR') {
            dispatch({ type: 'RESET_IDLE' });
          } else {
            fileInputRef.current?.click();
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
              const classified = classifyFile(file);
              dispatch({ type: 'DRAG_ENTER', file: classified });
              dispatch({ type: 'TYPE_DETECTED', category: classified.category });
            }
          }}
        />

        {context.state === 'PROCESSING' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={26} className="animate-spin" color="#f97316" />
            <span style={{ fontSize: '11px', fontWeight: '700' }}>Converting...</span>
          </div>
        ) : context.state === 'SUCCESS' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <CheckCircle size={26} color="#10b981" />
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981' }}>Converted!</span>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>Click to reset</span>
          </div>
        ) : context.state === 'ERROR' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '0 4px' }}>
            <AlertTriangle size={22} color="#ef4444" />
            <span style={{ fontSize: '10px', fontWeight: '700', color: '#ef4444', textAlign: 'center' }}>
              {context.errorMessage?.slice(0, 45) || 'Error'}
            </span>
          </div>
        ) : context.activeFile ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            {context.activeFile.category === 'document' ? (
              <FileText size={22} color="#10b981" />
            ) : (
              <ImageIcon size={22} color="#38bdf8" />
            )}
            <span style={{ fontSize: '11px', fontWeight: '800', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {context.activeFile.name}
            </span>
            <span style={{ fontSize: '9px', color: '#f97316', fontWeight: '700' }}>
              Select format ring
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={24} color="#f97316" />
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#f8fafc' }}>Drop File</span>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>Image or PDF</span>
          </div>
        )}
      </div>

      {/* Bottom Floating Action: Open Dashboard */}
      <button
        className="btn-glass widget-no-drag"
        onClick={handleOpenDashboard}
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '11px',
          padding: '4px 10px',
          borderRadius: '999px',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border-glass)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
        }}
      >
        <ExternalLink size={12} color="#f97316" />
        <span>Open Dashboard</span>
      </button>
    </div>
  );
};
