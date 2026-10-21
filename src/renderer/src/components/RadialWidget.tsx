import React, { useRef, useEffect } from 'react';
import {
  StateMachineContext,
  StateMachineAction
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
  extractExtension,
  detectFileCategory
} from '../core/FileClassifier';
import {
  FileCategory,
  RadialSector
} from '../../../shared/types';
import {
  FileText,
  Image as ImageIcon,
  Video,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  X,
  UploadCloud,
  FileCheck
} from 'lucide-react';

interface RadialWidgetProps {
  context: StateMachineContext;
  dispatch: React.Dispatch<StateMachineAction>;
  onExecuteDrop: (file: File, sector: RadialSector) => void;
  onOpenDashboard: () => void;
}

const CANVAS_SIZE = 500;
const CENTER = CANVAS_SIZE / 2;
const R_INNER = 85;
const R_OUTER = 195;

export const RadialWidget: React.FC<RadialWidgetProps> = ({
  context,
  dispatch,
  onExecuteDrop,
  onOpenDashboard
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCategory: FileCategory = context.activeFile?.category || 'unknown';
  const sectors = getCompatibleSectors(activeCategory);
  const isRingExpanded =
    (context.state === 'FORMAT_RING_VISIBLE' || context.state === 'SECTOR_HOVER') &&
    sectors.length > 0;

  // Global escape and keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'CANCEL_ESCAPE' });
      } else if (isRingExpanded) {
        if (e.key === 'ArrowRight') {
          const nextIndex = (context.hoveredSectorIndex + 1) % sectors.length;
          dispatch({
            type: 'SECTOR_HOVER',
            sectorIndex: nextIndex,
            sector: sectors[nextIndex]
          });
        } else if (e.key === 'ArrowLeft') {
          const prevIndex = (context.hoveredSectorIndex - 1 + sectors.length) % sectors.length;
          dispatch({
            type: 'SECTOR_HOVER',
            sectorIndex: prevIndex,
            sector: sectors[prevIndex]
          });
        } else if (e.key === 'Enter' && context.selectedSector && context.activeFile) {
          const syntheticFile = new File(['mock'], context.activeFile.name, {
            type: context.activeFile.mimeType
          });
          onExecuteDrop(syntheticFile, context.selectedSector);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRingExpanded, context.hoveredSectorIndex, sectors, context.selectedSector, context.activeFile, dispatch, onExecuteDrop]);

  // Handle continuous pointer tracking while dragging
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!isRingExpanded && sectors.length === 0 && context.activeFile) {
      dispatch({ type: 'EXPAND_RING' });
    }

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
        if (context.hoveredSectorIndex !== -1) {
          dispatch({ type: 'SECTOR_LEAVE' });
        }
      }
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();

    // Check if dragging files from Windows Explorer
    const isFileDrag =
      e.dataTransfer.types.includes('Files') ||
      (e.dataTransfer.items && Array.from(e.dataTransfer.items).some((item) => item.kind === 'file'));

    if (isFileDrag) {
      let mime = '';
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        mime = e.dataTransfer.items[0].type || '';
      }

      // If mime is empty, classifyFile will classify as 'generic_file' and open the universal ring
      const classified = classifyFile({
        name: mime ? `dragged-file` : `Explorer File`,
        type: mime
      });

      dispatch({ type: 'DRAG_ENTER', file: classified });
      dispatch({ type: 'TYPE_DETECTED', category: classified.category });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) {
      dispatch({ type: 'DROP_OUTSIDE' });
      return;
    }

    const firstFile = files[0];
    const realExt = extractExtension(firstFile.name);
    const realCategory = detectFileCategory(realExt, firstFile.type);

    const actualClassified = classifyFile({
      name: firstFile.name,
      path: window.radialAPI?.getPathForFile(firstFile) || firstFile.name,
      type: firstFile.type,
      size: firstFile.size
    });

    const activeSectors = getCompatibleSectors(context.activeFile?.category || 'generic_file');
    const hit = getRadialSectorHit(x, y, CENTER, CENTER, R_INNER, R_OUTER, activeSectors.length);

    if (hit.isInsideRing && hit.sectorIndex >= 0 && hit.sectorIndex < activeSectors.length) {
      const targetSector = activeSectors[hit.sectorIndex];

      // Validate compatibility with actual dropped file
      const check = validateConversionCompatibility(realExt, targetSector.format, realCategory);

      if (check.isSupported) {
        dispatch({ type: 'DRAG_ENTER', file: actualClassified });
        dispatch({ type: 'DROP_ON_SECTOR', sector: targetSector });
        onExecuteDrop(firstFile, targetSector);
      } else {
        dispatch({
          type: 'JOB_FAILED',
          error: check.reason || `Cannot convert .${realExt.toUpperCase()} to .${targetSector.format.toUpperCase()}`
        });
      }
    } else if (hit.isInsideCenter) {
      // Dropped on center circle: file classified, expand exact category ring
      dispatch({ type: 'DRAG_ENTER', file: actualClassified });
      dispatch({ type: 'TYPE_DETECTED', category: actualClassified.category });
    } else {
      dispatch({ type: 'DROP_OUTSIDE' });
    }
  };

  const handleManualFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const classified = classifyFile({
        name: file.name,
        path: window.radialAPI?.getPathForFile(file) || file.name,
        type: file.type,
        size: file.size
      });
      dispatch({ type: 'DRAG_ENTER', file: classified });
      dispatch({ type: 'TYPE_DETECTED', category: classified.category });
    }
  };

  const renderCategoryIcon = () => {
    switch (activeCategory) {
      case 'image':
        return <ImageIcon size={32} color="#ff7e5f" />;
      case 'video':
        return <Video size={32} color="#f97316" />;
      case 'document':
        return <FileText size={32} color="#3b82f6" />;
      case 'generic_file':
        return <FileCheck size={32} color="#ff7e5f" />;
      default:
        return <Sparkles size={32} color="#ff7e5f" />;
    }
  };

  const sectorSpan = sectors.length > 0 ? 360 / sectors.length : 0;

  return (
    <div
      ref={containerRef}
      className="widget-viewport"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleManualFileSelect}
      />

      {/* Radial Sector SVG Ring */}
      <svg
        className="radial-svg-canvas"
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
      >
        {isRingExpanded &&
          sectors.map((sector, index) => {
            const startAngle = index * sectorSpan;
            const endAngle = (index + 1) * sectorSpan;
            const isActive = context.hoveredSectorIndex === index;
            const pathData = generateArcSvgPath(CENTER, CENTER, R_INNER, R_OUTER, startAngle, endAngle, 3);

            return (
              <g key={sector.id}>
                <path
                  d={pathData}
                  className={`radial-sector-path ${isActive ? 'is-active' : ''}`}
                  onMouseEnter={() =>
                    dispatch({
                      type: 'SECTOR_HOVER',
                      sectorIndex: index,
                      sector
                    })
                  }
                  onClick={() => {
                    if (context.activeFile) {
                      const syntheticFile = new File(['mock'], context.activeFile.name, {
                        type: context.activeFile.mimeType
                      });
                      onExecuteDrop(syntheticFile, sector);
                    }
                  }}
                />
              </g>
            );
          })}
      </svg>

      {/* Sector Labels Overlay */}
      {isRingExpanded &&
        sectors.map((sector, index) => {
          const midAngle = (index + 0.5) * sectorSpan;
          const pos = polarToCartesian(CENTER, CENTER, (R_INNER + R_OUTER) / 2, midAngle);
          const isActive = context.hoveredSectorIndex === index;

          return (
            <div
              key={sector.id}
              className={`sector-overlay-tag ${isActive ? 'is-active' : ''}`}
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`
              }}
            >
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: '700',
                  color: isActive ? '#ff7e5f' : '#0f172a',
                  letterSpacing: '0.04em'
                }}
              >
                {sector.label}
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: '#64748b',
                  maxWidth: '90px',
                  textAlign: 'center',
                  lineHeight: '1.2'
                }}
              >
                {sector.description}
              </div>
            </div>
          );
        })}

      {/* Central Primary Circle */}
      <div
        className={`primary-circle glass-panel ${
          context.state === 'FILE_HOVER' || context.state === 'SECTOR_HOVER' ? 'is-dragging' : ''
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        {context.state === 'SUCCESS' ? (
          <div>
            <CheckCircle2 size={40} color="#10b981" style={{ marginBottom: 6 }} />
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#10b981' }}>Converted!</div>
            <button
              className="btn-glass"
              style={{ marginTop: 8, fontSize: '11px', padding: '4px 10px' }}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'RESET_IDLE' });
              }}
            >
              Done
            </button>
          </div>
        ) : context.state === 'ERROR' ? (
          <div style={{ padding: '0 8px' }}>
            <AlertTriangle size={32} color="#ef4444" style={{ marginBottom: 4 }} />
            <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: '600', lineHeight: 1.2 }}>
              {context.errorMessage || 'Unsupported'}
            </div>
            <button
              className="btn-glass"
              style={{ marginTop: 6, fontSize: '10px', padding: '3px 8px' }}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'RESET_IDLE' });
              }}
            >
              Dismiss
            </button>
          </div>
        ) : (
          <div>
            {context.activeFile ? (
              <div className="category-pill">
                {context.activeFile.isMimePending ? 'FILE DETECTED' : activeCategory}
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
              {renderCategoryIcon()}
            </div>

            {context.selectedSector ? (
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Target format</div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#ff7e5f' }}>
                  .{context.selectedSector.format.toUpperCase()}
                </div>
              </div>
            ) : context.activeFile ? (
              <div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '700',
                    maxWidth: '120px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={context.activeFile.name}
                >
                  {context.activeFile.name}
                </div>
                <div style={{ fontSize: '10px', color: '#64748b' }}>
                  {context.activeFile.isMimePending ? 'Drop on a format ring' : 'Release on target'}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
                  Radial Studio
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: 2 }}>
                  Drag file or click
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Bottom Navigation Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 10,
          zIndex: 20
        }}
      >
        <button className="btn-glass" onClick={onOpenDashboard}>
          <FolderOpen size={16} />
          <span>Dashboard & Database</span>
        </button>

        <button
          className="btn-glass"
          onClick={() => {
            const mock = classifyFile({ name: 'sample-report.docx', size: 204800 });
            dispatch({ type: 'DRAG_ENTER', file: mock });
            dispatch({ type: 'TYPE_DETECTED', category: mock.category });
          }}
          title="Inject mock document to test DOCX ring"
        >
          <UploadCloud size={16} />
          <span>Demo DOCX</span>
        </button>

        {context.state !== 'IDLE' && (
          <button
            className="btn-glass"
            onClick={() => dispatch({ type: 'CANCEL_ESCAPE' })}
            title="Reset to idle (Esc)"
          >
            <X size={16} />
            <span>Cancel</span>
          </button>
        )}
      </div>
    </div>
  );
};
