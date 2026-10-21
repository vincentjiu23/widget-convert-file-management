import React, { useState } from 'react';
import {
  ApprovedFolder,
  ConversionJob,
  FileIndexItem,
  ActivityLogItem,
  ScanProgress
} from '../../../shared/types';
import {
  Folder,
  FolderPlus,
  RefreshCw,
  X,
  FileCheck,
  Activity,
  Settings,
  HardDrive,
  Eye,
  Search,
  Database
} from 'lucide-react';

interface DashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: ApprovedFolder[];
  onToggleFolder: (id: string, currentEnabled: boolean) => void;
  onRescanFolder: (id: string) => void;
  onAddCustomFolder: () => void;
  onRemoveFolder: (id: string) => void;
  jobs: ConversionJob[];
  indexedFiles: FileIndexItem[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activityLogs: ActivityLogItem[];
  scanProgress: ScanProgress | null;
  totalIndexedCount: number;
}

export const DashboardModal: React.FC<DashboardModalProps> = ({
  isOpen,
  onClose,
  folders,
  onToggleFolder,
  onRescanFolder,
  onAddCustomFolder,
  onRemoveFolder,
  jobs,
  indexedFiles,
  searchQuery,
  onSearchChange,
  activityLogs,
  scanProgress,
  totalIndexedCount
}) => {
  const [activeTab, setActiveTab] = useState<'folders' | 'index' | 'jobs' | 'activity' | 'settings'>('folders');

  if (!isOpen) return null;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="dashboard-modal-backdrop" onClick={onClose}>
      <div
        className="dashboard-modal-content glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '24px', maxWidth: '820px' }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                Radial File Studio
              </h2>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#0284c7'
                }}
              >
                SQLite Indexed: {totalIndexedCount} Files
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Local-first Windows management, native filesystem watcher & security registry
            </p>
          </div>
          <button className="btn-glass" onClick={onClose} style={{ padding: '6px 12px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Scan Progress Alert if Active */}
        {scanProgress && !scanProgress.isComplete && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(255, 126, 95, 0.12)',
              border: '1px solid rgba(255, 126, 95, 0.3)',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={14} className="animate-spin" color="#ff7e5f" />
              <span>
                <strong>Scanning:</strong> {pathBasename(scanProgress.folderPath)} ({scanProgress.scannedFiles} files discovered)
              </span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {scanProgress.currentPath}
            </span>
          </div>
        )}

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(226, 232, 240, 0.6)', paddingBottom: '10px' }}>
          <button
            className={`btn-glass ${activeTab === 'folders' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('folders')}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <Folder size={14} />
            <span>Approved Folders ({folders.length})</span>
          </button>

          <button
            className={`btn-glass ${activeTab === 'index' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('index')}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <Database size={14} />
            <span>File Index ({indexedFiles.length})</span>
          </button>

          <button
            className={`btn-glass ${activeTab === 'jobs' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('jobs')}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <FileCheck size={14} />
            <span>Conversion Queue ({jobs.length})</span>
          </button>

          <button
            className={`btn-glass ${activeTab === 'activity' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('activity')}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <Activity size={14} />
            <span>Activity & Watcher</span>
          </button>

          <button
            className={`btn-glass ${activeTab === 'settings' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('settings')}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </div>

        {/* Tab: Approved Folders */}
        {activeTab === 'folders' && (
          <div style={{ overflowY: 'auto', maxHeight: '50vh', paddingRight: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                Only approved folders are indexed and monitored by Windows kernel watcher:
              </div>
              <button className="btn-glass" onClick={onAddCustomFolder} style={{ fontSize: '11px', padding: '6px 12px' }}>
                <FolderPlus size={14} color="#ff7e5f" />
                <span>Add Folder (Native Picker)</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className="glass-panel-subtle"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '14px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input
                      type="checkbox"
                      checked={folder.enabled}
                      onChange={() => onToggleFolder(folder.id, folder.enabled)}
                      style={{ width: '16px', height: '16px', accentColor: '#ff7e5f', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b' }}>
                        {folder.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {folder.path}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                        {folder.file_count || 0} files indexed • Status: <strong>{folder.scan_status}</strong>
                        {folder.last_scan_at ? ` • Last scan: ${new Date(folder.last_scan_at).toLocaleTimeString()}` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      className="btn-glass"
                      style={{ padding: '5px 8px', fontSize: '11px' }}
                      onClick={() => onRescanFolder(folder.id)}
                      title="Reconcile and rescan folder"
                    >
                      <RefreshCw size={13} color="#ff7e5f" />
                      <span>Rescan</span>
                    </button>

                    <button
                      className="btn-glass"
                      style={{ padding: '5px 8px', fontSize: '11px' }}
                      onClick={() => onRemoveFolder(folder.id)}
                      title="Remove folder from approval list"
                    >
                      <X size={13} color="#ef4444" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Local File Index */}
        {activeTab === 'index' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '50vh' }}>
            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search indexed files by filename or path in SQLite database..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 36px',
                  borderRadius: '12px',
                  border: '1px solid rgba(226, 232, 240, 0.8)',
                  background: 'rgba(255, 255, 255, 0.9)',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {indexedFiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  <Database size={32} style={{ marginBottom: 6, opacity: 0.5 }} />
                  <div style={{ fontSize: '13px', fontWeight: '600' }}>No files found in index</div>
                  <div style={{ fontSize: '11px' }}>Approved folders will appear here once scanned.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {indexedFiles.map((item) => (
                    <div
                      key={item.id}
                      className="glass-panel-subtle"
                      style={{
                        padding: '8px 12px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '580px' }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: '700',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 126, 95, 0.15)',
                            color: '#ff7e5f',
                            marginRight: '8px'
                          }}
                        >
                          {item.category.toUpperCase()}
                        </span>
                        <strong style={{ color: '#0f172a' }}>{item.name}</strong>
                        <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '8px' }}>
                          {formatBytes(item.size_bytes)} • {new Date(item.mtime_ms).toLocaleDateString()}
                        </span>
                        <div style={{ fontSize: '10px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.path}
                        </div>
                      </div>

                      {window.radialAPI && (
                        <button
                          className="btn-glass"
                          style={{ padding: '4px 8px', fontSize: '10px' }}
                          onClick={() => window.radialAPI?.showItemInFolder(item.path)}
                          title="Reveal in Explorer"
                        >
                          <Eye size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Conversion Queue */}
        {activeTab === 'jobs' && (
          <div style={{ overflowY: 'auto', maxHeight: '50vh', paddingRight: '4px' }}>
            {jobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                <HardDrive size={32} style={{ marginBottom: 6, opacity: 0.5 }} />
                <div style={{ fontSize: '13px', fontWeight: '600' }}>No conversion jobs recorded</div>
                <div style={{ fontSize: '11px' }}>Drag files onto the radial circle to convert.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="glass-panel-subtle"
                    style={{
                      padding: '12px 16px',
                      borderRadius: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
                        {job.sourceFileName} ➔ <span style={{ color: '#ff7e5f' }}>.{job.outputFormat.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {job.outputPath || job.sourcePath}
                      </div>
                      {job.engineMessage && (
                        <div style={{ fontSize: '10px', color: '#d97706', marginTop: '2px', fontStyle: 'italic' }}>
                          ⚠ {job.engineMessage}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '999px',
                          background: job.status === 'SUCCEEDED'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : job.status === 'PREVIEW_RECORDED'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : job.status === 'FAILED'
                                ? 'rgba(239, 68, 68, 0.15)'
                                : 'rgba(100, 116, 139, 0.15)',
                          color: job.status === 'SUCCEEDED'
                            ? '#059669'
                            : job.status === 'PREVIEW_RECORDED'
                              ? '#d97706'
                              : job.status === 'FAILED'
                                ? '#dc2626'
                                : '#64748b'
                        }}
                      >
                        {job.status === 'PREVIEW_RECORDED' ? 'PREVIEW' : job.status}
                      </span>
                      {job.status === 'SUCCEEDED' && job.outputPath && window.radialAPI && (
                        <button
                          className="btn-glass"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => window.radialAPI?.showItemInFolder(job.outputPath!)}
                        >
                          <Eye size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Activity & Watcher Logs */}
        {activeTab === 'activity' && (
          <div style={{ overflowY: 'auto', maxHeight: '50vh', paddingRight: '4px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>
              Persistent activity events & native Windows kernel filesystem notifications:
            </div>
            {activityLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '12px' }}>
                No activity recorded yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activityLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      fontSize: '11px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(241, 245, 249, 0.8)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: '700', color: '#ff7e5f', marginRight: '6px' }}>
                        [{log.event_type}]
                      </span>
                      <span style={{ color: '#1e293b' }}>{log.summary}</span>
                    </div>
                    <span style={{ color: '#94a3b8', fontSize: '10px' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Settings */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="glass-panel-subtle" style={{ padding: '14px', borderRadius: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>
                Authoritative Path Security
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                All filesystem operations are validated against approved folders in the Electron main process. Path traversal (..), null bytes, and sensitive system folders (C:\Windows) are strictly blocked.
              </div>
            </div>

            <div className="glass-panel-subtle" style={{ padding: '14px', borderRadius: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>
                Persistent SQLite Database
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Indexed metadata is stored persistently in SQLite. Files are not re-scanned from scratch every time the app opens.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function pathBasename(fullPath: string): string {
  if (!fullPath) return '';
  return fullPath.split(/[\\/]/).pop() || fullPath;
}
