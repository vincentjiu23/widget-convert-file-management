import React, { useState } from 'react';
import { SelectedFolder, ConversionJob } from '../../../shared/types';
import {
  Folder,
  FolderPlus,
  RefreshCw,
  CheckCircle,
  X,
  FileCheck,
  Activity,
  Settings,
  HardDrive,
  Eye,
  Trash2
} from 'lucide-react';

interface DashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: SelectedFolder[];
  onToggleFolder: (id: string) => void;
  onAddCustomFolder: () => void;
  jobs: ConversionJob[];
  watcherLogs: Array<{ dirPath: string; eventType: string; filename: string; timestamp: number }>;
}

export const DashboardModal: React.FC<DashboardModalProps> = ({
  isOpen,
  onClose,
  folders,
  onToggleFolder,
  onAddCustomFolder,
  jobs,
  watcherLogs
}) => {
  const [activeTab, setActiveTab] = useState<'folders' | 'jobs' | 'activity' | 'settings'>('folders');

  if (!isOpen) return null;

  return (
    <div className="dashboard-modal-backdrop" onClick={onClose}>
      <div
        className="dashboard-modal-content glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '24px' }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
              Radial File Studio
            </h2>
            <p style={{ fontSize: '12px', color: '#64748b' }}>
              Local file management, background watcher & conversion monitor
            </p>
          </div>
          <button className="btn-glass" onClick={onClose} style={{ padding: '6px 12px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid rgba(226, 232, 240, 0.6)', paddingBottom: '12px' }}>
          <button
            className={`btn-glass ${activeTab === 'folders' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('folders')}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            <Folder size={14} />
            <span>Monitored Folders ({folders.filter(f => f.enabled).length})</span>
          </button>
          <button
            className={`btn-glass ${activeTab === 'jobs' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('jobs')}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            <FileCheck size={14} />
            <span>Conversion Queue ({jobs.length})</span>
          </button>
          <button
            className={`btn-glass ${activeTab === 'activity' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('activity')}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            <Activity size={14} />
            <span>Filesystem Events ({watcherLogs.length})</span>
          </button>
          <button
            className={`btn-glass ${activeTab === 'settings' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('settings')}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </div>

        {/* Tab Content: Monitored Folders */}
        {activeTab === 'folders' && (
          <div style={{ overflowY: 'auto', maxHeight: '55vh', paddingRight: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', color: '#334155', fontWeight: '600' }}>
                Onboarding Folder Selection (Explicit approval required)
              </div>
              <button className="btn-glass" onClick={onAddCustomFolder} style={{ fontSize: '11px', padding: '6px 12px' }}>
                <FolderPlus size={14} color="#ff7e5f" />
                <span>Add Custom Folder</span>
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
                      onChange={() => onToggleFolder(folder.id)}
                      style={{ width: '16px', height: '16px', accentColor: '#ff7e5f', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b' }}>
                        {folder.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {folder.path}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {folder.enabled ? (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '999px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#059669'
                        }}
                      >
                        WATCHING
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '600',
                          padding: '3px 8px',
                          borderRadius: '999px',
                          background: 'rgba(148, 163, 184, 0.2)',
                          color: '#64748b'
                        }}
                      >
                        OFFLINE
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Content: Conversion Queue */}
        {activeTab === 'jobs' && (
          <div style={{ overflowY: 'auto', maxHeight: '55vh', paddingRight: '6px' }}>
            {jobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                <HardDrive size={36} style={{ marginBottom: '8px', opacity: 0.5 }} />
                <div style={{ fontSize: '13px', fontWeight: '600' }}>No conversion jobs recorded yet</div>
                <div style={{ fontSize: '11px' }}>Drag and drop files onto the radial circle to start</div>
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
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: '700',
                          padding: '3px 10px',
                          borderRadius: '999px',
                          background:
                            job.status === 'SUCCEEDED'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : job.status === 'RUNNING'
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                          color:
                            job.status === 'SUCCEEDED'
                              ? '#059669'
                              : job.status === 'RUNNING'
                              ? '#2563eb'
                              : '#dc2626'
                        }}
                      >
                        {job.status}
                      </span>

                      {job.outputPath && window.radialAPI && (
                        <button
                          className="btn-glass"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => window.radialAPI?.showItemInFolder(job.outputPath!)}
                          title="Reveal in File Explorer"
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

        {/* Tab Content: Filesystem Watcher Events */}
        {activeTab === 'activity' && (
          <div style={{ overflowY: 'auto', maxHeight: '55vh', paddingRight: '6px' }}>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
              Real-time Windows kernel filesystem change notifications via native I/O completion port:
            </div>
            {watcherLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '12px' }}>
                Awaiting filesystem events... Modify or add files in approved folders to inspect notifications.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {watcherLogs.slice(-20).reverse().map((log, index) => (
                  <div
                    key={index}
                    style={{
                      fontSize: '11px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(241, 245, 249, 0.8)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontFamily: 'monospace'
                    }}
                  >
                    <span>
                      <strong style={{ color: '#ff7e5f' }}>[{log.eventType.toUpperCase()}]</strong> {log.filename}
                    </span>
                    <span style={{ color: '#94a3b8' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Settings */}
        {activeTab === 'settings' && (
          <div style={{ overflowY: 'auto', maxHeight: '55vh', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="glass-panel-subtle" style={{ padding: '14px', borderRadius: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>
                Output Destination Policy
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
                Save converted files in the same directory as source file by default (Never overwrites existing files).
              </div>
              <div style={{ fontSize: '12px', color: '#0f172a', fontWeight: '600' }}>
                ✓ Collision policy: Generate unique suffix (e.g. filename (1).png)
              </div>
            </div>

            <div className="glass-panel-subtle" style={{ padding: '14px', borderRadius: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>
                Privacy & Data Storage
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Local processing only. No data or telemetry uploaded to cloud services.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
