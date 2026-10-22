import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
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
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [unapprovedFolderInfo, setUnapprovedFolderInfo] = useState<{
    folderPath: string;
    folderName: string;
    sourcePath: string;
    sector?: RadialSector;
  } | null>(null);

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
  const resolveFilePath = useCallback((file: File | null): string => {
    if (!file) return '';

    // Primary: Electron webUtils via exposed preload API
    if (window.radialAPI?.getPathForFile) {
      try {
        const p = window.radialAPI.getPathForFile(file);
        if (p && typeof p === 'string' && (p.includes('\\') || p.includes('/'))) {
          return p.trim();
        }
      } catch (err) {
        console.warn('[WidgetView] webUtils.getPathForFile error:', err);
      }
    }

    // Secondary fallback: Native File.path property for environments that support it
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
   * Guarantees mouse events are NEVER ignored while an external file drag is in progress.
   */
  useEffect(() => {
    let isIgnoring = false;
    let dragCounter = 0;

    const updateIgnoreMouseEvents = (shouldIgnore: boolean) => {
      if (shouldIgnore !== isIgnoring) {
        window.radialAPI?.setIgnoreMouseEvents(shouldIgnore, shouldIgnore);
        isIgnoring = shouldIgnore;
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      // While dragging a file, NEVER ignore mouse events
      if (dragCounter > 0) return;

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

      updateIgnoreMouseEvents(!isInteractive);
    };

    const handleMouseLeave = (e: MouseEvent) => {
      if (dragCounter > 0) return;
      if (!e.relatedTarget) {
        updateIgnoreMouseEvents(true);
      }
    };

    const handleWindowBlur = () => {
      dragCounter = 0;
      setIsDraggingFile(false);
      updateIgnoreMouseEvents(true);
    };

    // Native Drag and Drop window listeners
    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      setIsDraggingFile(true);
      updateIgnoreMouseEvents(false);
    };

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      updateIgnoreMouseEvents(false);
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setIsDraggingFile(false);
      }
    };

    const handleWindowDrop = () => {
      dragCounter = 0;
      setIsDraggingFile(false);
      updateIgnoreMouseEvents(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
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
      setShowErrorDetail(true);
      return;
    }

    const jobId = `job-${Date.now()}`;
    dispatch({ type: 'JOB_STARTED', jobId });
    setShowErrorDetail(false);
    setUnapprovedFolderInfo(null);

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
        setShowErrorDetail(true);
      }
    } catch (err: unknown) {
      dispatch({
        type: 'JOB_FAILED',
        error: err instanceof Error ? err.message : String(err)
      });
      setShowErrorDetail(true);
    }
  };

  /**
   * Authorizes an unapproved source folder and proceeds with conversion.
   */
  const handleApproveFolderAndConvert = async () => {
    if (!unapprovedFolderInfo || !window.radialAPI) return;

    try {
      const res = await window.radialAPI.addApprovedFolder(
        unapprovedFolderInfo.folderPath,
        unapprovedFolderInfo.folderName
      );

      if (res.success) {
        const { sourcePath, sector } = unapprovedFolderInfo;
        setUnapprovedFolderInfo(null);
        setShowErrorDetail(false);

        if (sector) {
          executeConversion(sourcePath, sector);
        } else {
          const fileName = sourcePath.split(/[/\\]/).pop() || sourcePath;
          const classified = classifyFile({ name: fileName, path: sourcePath });
          dispatch({ type: 'DRAG_ENTER', file: classified });
          dispatch({ type: 'TYPE_DETECTED', category: classified.category });
        }
      } else {
        dispatch({
          type: 'JOB_FAILED',
          error: `Could not approve folder: ${res.error || 'Unknown error'}`
        });
        setShowErrorDetail(true);
      }
    } catch (err: unknown) {
      dispatch({
        type: 'JOB_FAILED',
        error: `Error approving folder: ${err instanceof Error ? err.message : String(err)}`
      });
      setShowErrorDetail(true);
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
          setUnapprovedFolderInfo(null);
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
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }

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

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    // Retrieve file from native event or dataTransfer
    const dt = e.nativeEvent?.dataTransfer || e.dataTransfer;
    let file: File | null = null;

    if (dt?.files && dt.files.length > 0) {
      file = dt.files[0];
    } else if (dt?.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === 'file') {
          file = item.getAsFile();
          if (file) break;
        }
      }
    }

    if (!file) {
      dispatch({ type: 'DROP_OUTSIDE' });
      return;
    }

    const resolvedPath = resolveFilePath(file);

    if (!resolvedPath) {
      dispatch({
        type: 'JOB_FAILED',
        error: 'Cannot read file path from drop. Please click the center circle to select your file directly.'
      });
      setShowErrorDetail(true);
      return;
    }

    // Security & Scope validation check via main process
    let isApproved = true;
    let folderPath = '';
    let folderName = '';

    if (window.radialAPI?.checkPathPermission) {
      try {
        const access = await window.radialAPI.checkPathPermission(resolvedPath);
        if (!access.exists) {
          dispatch({
            type: 'JOB_FAILED',
            error: `File not found on disk: ${access.error || resolvedPath}`
          });
          setShowErrorDetail(true);
          return;
        }
        isApproved = access.isApproved;
        folderPath = access.folderPath || '';
        folderName = access.folderName || '';
      } catch (err) {
        console.warn('[WidgetView] checkPathPermission error:', err);
      }
    }

    // Check if dropped onto an active radial sector
    if (containerRef.current && sectors.length > 0) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = getRadialSectorHit(x, y, CENTER, CENTER, R_INNER, R_OUTER, sectors.length);

      if (hit.isInsideRing && hit.sectorIndex >= 0 && hit.sectorIndex < sectors.length) {
        const sector = sectors[hit.sectorIndex];
        dispatch({ type: 'DROP_ON_SECTOR', sector });

        if (!isApproved && folderPath) {
          setUnapprovedFolderInfo({
            folderPath,
            folderName,
            sourcePath: resolvedPath,
            sector
          });
          dispatch({
            type: 'JOB_FAILED',
            error: `Folder "${folderName}" is not approved. Click below to approve and convert.`
          });
          setShowErrorDetail(true);
          return;
        }

        executeConversion(resolvedPath, sector);
        return;
      }
    }

    // Dropped onto center drop zone:
    if (!isApproved && folderPath) {
      setUnapprovedFolderInfo({
        folderPath,
        folderName,
        sourcePath: resolvedPath
      });
      const classified = classifyFile({
        name: file.name,
        path: resolvedPath,
        type: file.type,
        size: file.size
      });
      dispatch({ type: 'DRAG_ENTER', file: classified });
      dispatch({ type: 'TYPE_DETECTED', category: classified.category });
      dispatch({
        type: 'JOB_FAILED',
        error: `Folder "${folderName}" requires permission. Click below to approve access.`
      });
      setShowErrorDetail(true);
      return;
    }

    // Dropped onto center circle and folder is approved:
    setUnapprovedFolderInfo(null);
    const classified = classifyFile({
      name: file.name,
      path: resolvedPath,
      type: file.type,
      size: file.size
    });
    dispatch({ type: 'DRAG_ENTER', file: classified });
    dispatch({ type: 'TYPE_DETECTED', category: classified.category });
    setShowErrorDetail(false);
  };

  return (
    <div
      className="widget-window-container"
      ref={containerRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
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
          className="radial-svg-canvas widget-no-drag"
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
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
                    setShowErrorDetail(true);
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

      {/* Central Primary Circle (Frosted Transparent Acrylic Glass Drop Zone) */}
      <div
        className={`primary-circle widget-no-drag ${isDraggingFile || context.state === 'FILE_HOVER' ? 'is-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (context.state === 'SUCCESS' || context.state === 'ERROR') {
            dispatch({ type: 'RESET_IDLE' });
            setShowErrorDetail(false);
            setUnapprovedFolderInfo(null);
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
              setUnapprovedFolderInfo(null);
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
            <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Click for options</span>
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
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#ffffff' }}>
              {isDraggingFile ? 'Drop Here' : 'Drop File'}
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>or click to browse</span>
          </div>
        )}
      </div>

      {/* Structured Compact Error Pill & Approval Flow */}
      {context.state === 'ERROR' && showErrorDetail && context.errorMessage && (
        <div
          className="widget-error-pill widget-no-drag"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px', padding: '10px 14px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} color="#f87171" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '11px', color: '#ffffff', lineHeight: 1.3, fontWeight: '600' }}>
              {context.errorMessage}
            </span>
            <X
              size={12}
              color="var(--text-muted)"
              style={{ cursor: 'pointer', marginLeft: 'auto', flexShrink: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                setShowErrorDetail(false);
                setUnapprovedFolderInfo(null);
              }}
            />
          </div>

          {unapprovedFolderInfo && (
            <button
              className="btn-glass"
              onClick={(e) => {
                e.stopPropagation();
                handleApproveFolderAndConvert();
              }}
              style={{
                fontSize: '11px',
                padding: '6px 12px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(249, 115, 22, 0.85)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '700'
              }}
            >
              <FolderOpen size={13} style={{ marginRight: '6px' }} />
              Approve "{unapprovedFolderInfo.folderName}" & Convert
            </button>
          )}
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
