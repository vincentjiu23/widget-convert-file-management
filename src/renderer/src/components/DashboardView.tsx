import React, { useState, useMemo } from 'react';
import {
  ApprovedFolder,
  ConversionJob,
  FileIndexItem,
  ActivityLogItem,
  ScanProgress
} from '../../../shared/types';
import {
  LayoutDashboard,
  FolderCheck,
  ListOrdered,
  HardDrive,
  Settings,
  FolderPlus,
  RefreshCw,
  FolderOpen,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  RotateCcw,
  Trash2,
  Search,
  Sparkles,
  Layers,
  ArrowRight,
  Monitor
} from 'lucide-react';

interface DashboardViewProps {
  folders: ApprovedFolder[];
  jobs: ConversionJob[];
  indexedFiles: FileIndexItem[];
  activityLogs: ActivityLogItem[];
  scanProgress: ScanProgress | null;
  totalIndexedCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onAddFolder: () => void;
  onRemoveFolder: (id: string) => void;
  onToggleFolder: (id: string, currentEnabled: boolean) => void;
  onRescanFolder: (id: string) => void;
  onRefreshData: () => void;
  onClearCompletedJobs: () => void;
  onRetryJob: (id: string) => void;
  onCancelJob: (id: string) => void;
  onOpenDashboardWidget: () => void;
  onToggleWidgetWindow: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  folders,
  jobs,
  indexedFiles,
  activityLogs,
  scanProgress,
  totalIndexedCount,
  searchQuery,
  onSearchChange,
  onAddFolder,
  onRemoveFolder,
  onToggleFolder,
  onRescanFolder,
  onRefreshData,
  onClearCompletedJobs,
  onRetryJob,
  onCancelJob,
  onToggleWidgetWindow
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'queue' | 'folders' | 'explorer' | 'settings'>('overview');
  const [selectedFileForConvert, setSelectedFileForConvert] = useState<File | null>(null);
  const [targetFormat, setTargetFormat] = useState<string>('png');
  const [isConverting, setIsConverting] = useState(false);
  const [conversionMessage, setConversionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [explorerCategoryFilter, setExplorerCategoryFilter] = useState<string>('all');
  const [queueStatusFilter, setQueueStatusFilter] = useState<string>('all');

  // File stats breakdown
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = { image: 0, document: 0, video: 0, generic_file: 0 };
    for (const f of indexedFiles) {
      const cat = f.category.toLowerCase();
      if (stats[cat] !== undefined) {
        stats[cat]++;
      } else {
        stats.generic_file++;
      }
    }
    return stats;
  }, [indexedFiles]);

  // Job counts breakdown
  const jobStats = useMemo(() => {
    const counts = { completed: 0, failed: 0, unsupported: 0, active: 0 };
    for (const j of jobs) {
      if (j.status === 'SUCCEEDED') counts.completed++;
      else if (j.status === 'FAILED') counts.failed++;
      else if (j.status === 'UNSUPPORTED') counts.unsupported++;
      else if (j.status === 'RUNNING' || j.status === 'QUEUED') counts.active++;
    }
    return counts;
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    if (queueStatusFilter === 'all') return jobs;
    return jobs.filter((j) => j.status.toUpperCase() === queueStatusFilter.toUpperCase());
  }, [jobs, queueStatusFilter]);

  const filteredExplorerFiles = useMemo(() => {
    return indexedFiles.filter((f) => {
      const matchesSearch = !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCat = explorerCategoryFilter === 'all' || f.category.toLowerCase() === explorerCategoryFilter.toLowerCase();
      return matchesSearch && matchesCat;
    });
  }, [indexedFiles, searchQuery, explorerCategoryFilter]);

  const handleQuickConvert = async () => {
    if (!selectedFileForConvert || !window.radialAPI) return;

    setIsConverting(true);
    setConversionMessage(null);

    try {
      const filePath = window.radialAPI.getPathForFile(selectedFileForConvert) || selectedFileForConvert.name;
      const res = await window.radialAPI.convertFile(filePath, targetFormat);

      if (res.success && res.outputPath) {
        setConversionMessage({
          type: 'success',
          text: `Success! Converted to ${targetFormat.toUpperCase()}: ${res.outputPath.split(/[/\\]/).pop()}`
        });
        setSelectedFileForConvert(null);
        onRefreshData();
      } else {
        setConversionMessage({
          type: 'error',
          text: res.error || 'Conversion failed.'
        });
        onRefreshData();
      }
    } catch (err: unknown) {
      setConversionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
      onRefreshData();
    } finally {
      setIsConverting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="app-dashboard-container">
      {/* Header Bar */}
      <header className="app-header">
        <div className="app-brand">
          <div className="app-brand-logo">
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '15px', fontWeight: '800', letterSpacing: '-0.2px' }}>Radial File Studio</h1>
              <span className="status-badge status-processing" style={{ fontSize: '10px' }}>
                Windows Desktop
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              Verified SQLite Index &bull; {totalIndexedCount} Files
            </span>
          </div>
        </div>

        {/* Central Nav Tabs */}
        <nav className="app-nav-tabs">
          <button
            className={`app-nav-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <LayoutDashboard size={15} />
            <span>Overview</span>
          </button>
          <button
            className={`app-nav-tab ${activeTab === 'queue' ? 'active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            <ListOrdered size={15} />
            <span>Conversion Queue ({jobs.length})</span>
          </button>
          <button
            className={`app-nav-tab ${activeTab === 'folders' ? 'active' : ''}`}
            onClick={() => setActiveTab('folders')}
          >
            <FolderCheck size={15} />
            <span>Approved Folders ({folders.length})</span>
          </button>
          <button
            className={`app-nav-tab ${activeTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            <HardDrive size={15} />
            <span>File Explorer</span>
          </button>
          <button
            className={`app-nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={15} />
            <span>Settings</span>
          </button>
        </nav>

        {/* Header Right Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            className="btn-glass"
            onClick={onToggleWidgetWindow}
            title="Toggle Floating Desktop Radial Widget"
            style={{ fontSize: '12px' }}
          >
            <Monitor size={14} color="#f97316" />
            <span>Desktop Widget</span>
          </button>
          <button
            className="btn-glass"
            onClick={onRefreshData}
            title="Refresh SQLite & Watcher status"
            style={{ padding: '7px 10px' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="app-main-content">
        {/* Background Scan Notification Bar */}
        {scanProgress && !scanProgress.isComplete && (
          <div
            className="glass-card"
            style={{
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(249, 115, 22, 0.12)',
              borderColor: 'rgba(249, 115, 22, 0.3)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <RefreshCw size={16} className="animate-spin" color="#f97316" />
              <div>
                <strong style={{ fontSize: '13px' }}>Background Reconciler Active</strong>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Scanning {scanProgress.folderPath.split(/[/\\]/).pop()} ({scanProgress.scannedFiles} discovered)
                </p>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {scanProgress.currentPath}
            </span>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              <div className="glass-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Indexed Files</span>
                  <HardDrive size={16} color="#38bdf8" />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '8px' }}>
                  {totalIndexedCount}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Managed in local SQLite</span>
              </div>

              <div className="glass-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Approved Folders</span>
                  <FolderCheck size={16} color="#10b981" />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '8px' }}>
                  {folders.filter((f) => f.enabled).length} / {folders.length}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Active Native Watchers</span>
              </div>

              <div className="glass-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Conversions Succeeded</span>
                  <CheckCircle2 size={16} color="#10b981" />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '8px' }}>
                  {jobStats.completed}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Verified outputs written</span>
              </div>

              <div className="glass-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Jobs in Queue</span>
                  <ListOrdered size={16} color="#f97316" />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '8px' }}>
                  {jobStats.active}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Pending or Processing</span>
              </div>
            </div>

            {/* Quick Conversion Zone */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Quick File Converter</h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Convert supported images (PNG, JPEG, WEBP, BMP, TIFF) and extract plain text from PDFs (.TXT).
                  </p>
                </div>
                {selectedFileForConvert && (
                  <button
                    className="btn-glass"
                    onClick={() => {
                      setSelectedFileForConvert(null);
                      setConversionMessage(null);
                    }}
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {conversionMessage && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    background: conversionMessage.type === 'success' ? 'var(--status-completed-bg)' : 'var(--status-failed-bg)',
                    border: `1px solid ${conversionMessage.type === 'success' ? 'var(--status-completed)' : 'var(--status-failed)'}`,
                    color: conversionMessage.type === 'success' ? 'var(--status-completed)' : 'var(--status-failed)'
                  }}
                >
                  {conversionMessage.text}
                </div>
              )}

              {!selectedFileForConvert ? (
                <label
                  className="drop-zone-card"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('drag-over');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('drag-over');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drag-over');
                    if (e.dataTransfer.files.length > 0) {
                      const file = e.dataTransfer.files[0];
                      setSelectedFileForConvert(file);
                      const ext = file.name.split('.').pop()?.toLowerCase();
                      if (ext === 'pdf') setTargetFormat('txt');
                      else setTargetFormat('png');
                    }
                  }}
                >
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0];
                        setSelectedFileForConvert(file);
                        const ext = file.name.split('.').pop()?.toLowerCase();
                        if (ext === 'pdf') setTargetFormat('txt');
                        else setTargetFormat('png');
                      }
                    }}
                  />
                  <FolderOpen size={36} color="#f97316" style={{ marginBottom: '12px' }} />
                  <span style={{ fontSize: '14px', fontWeight: '700' }}>Drop file here or click to browse</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Supports Images (JPG, PNG, WEBP, BMP, TIFF) and PDF Documents
                  </span>
                </label>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderRadius: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {selectedFileForConvert.name.endsWith('.pdf') ? (
                        <FileText size={24} color="#ef4444" />
                      ) : (
                        <ImageIcon size={24} color="#38bdf8" />
                      )}
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: '700' }}>{selectedFileForConvert.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Size: {formatBytes(selectedFileForConvert.size)} &bull; Format: .{selectedFileForConvert.name.split('.').pop()?.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Target:</span>
                        {selectedFileForConvert.name.toLowerCase().endsWith('.pdf') ? (
                          <select
                            value={targetFormat}
                            onChange={(e) => setTargetFormat(e.target.value)}
                            style={{
                              background: 'rgba(15, 23, 42, 0.8)',
                              color: 'white',
                              border: '1px solid var(--border-glass)',
                              padding: '6px 12px',
                              borderRadius: '8px',
                              fontSize: '13px'
                            }}
                          >
                            <option value="txt">TXT (Plain Text Extraction)</option>
                          </select>
                        ) : (
                          <select
                            value={targetFormat}
                            onChange={(e) => setTargetFormat(e.target.value)}
                            style={{
                              background: 'rgba(15, 23, 42, 0.8)',
                              color: 'white',
                              border: '1px solid var(--border-glass)',
                              padding: '6px 12px',
                              borderRadius: '8px',
                              fontSize: '13px'
                            }}
                          >
                            <option value="png">PNG (Lossless)</option>
                            <option value="jpg">JPEG (Compressed)</option>
                            <option value="webp">WEBP (Web format)</option>
                            <option value="bmp">BMP (Windows Bitmap)</option>
                            <option value="tiff">TIFF (Archival)</option>
                          </select>
                        )}
                      </div>

                      <button
                        className="btn-glass btn-primary"
                        onClick={handleQuickConvert}
                        disabled={isConverting}
                      >
                        {isConverting ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            <span>Converting...</span>
                          </>
                        ) : (
                          <>
                            <ArrowRight size={14} />
                            <span>Start Conversion</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Honest Data Charts & Recent Activity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Chart 1: File Categories Distribution */}
              <div className="glass-card">
                <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '14px' }}>
                  Indexed Files by Category
                </h3>
                {totalIndexedCount === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No indexed files yet. Approve a folder to begin indexing.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {[
                      { label: 'Images', count: categoryStats.image, color: '#38bdf8' },
                      { label: 'Documents', count: categoryStats.document, color: '#10b981' },
                      { label: 'Videos', count: categoryStats.video, color: '#f97316' },
                      { label: 'Other Files', count: categoryStats.generic_file, color: '#94a3b8' }
                    ].map((cat) => {
                      const pct = totalIndexedCount > 0 ? Math.round((cat.count / totalIndexedCount) * 100) : 0;
                      return (
                        <div key={cat.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span>{cat.label}</span>
                            <span style={{ fontWeight: '700' }}>
                              {cat.count} ({pct}%)
                            </span>
                          </div>
                          <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: cat.color, borderRadius: '4px' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Chart 2: Conversion Status Breakdown */}
              <div className="glass-card">
                <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '14px' }}>
                  Conversion Queue Status History
                </h3>
                {jobs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No conversion jobs recorded yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {[
                      { label: 'Completed', count: jobStats.completed, color: '#10b981' },
                      { label: 'Failed', count: jobStats.failed, color: '#ef4444' },
                      { label: 'Unsupported', count: jobStats.unsupported, color: '#a855f7' },
                      { label: 'Active / Queued', count: jobStats.active, color: '#f97316' }
                    ].map((st) => {
                      const pct = jobs.length > 0 ? Math.round((st.count / jobs.length) * 100) : 0;
                      return (
                        <div key={st.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span>{st.label}</span>
                            <span style={{ fontWeight: '700' }}>
                              {st.count} ({pct}%)
                            </span>
                          </div>
                          <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: st.color, borderRadius: '4px' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CONVERSION QUEUE */}
        {activeTab === 'queue' && (
          <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Conversion Queue Management</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Authoritative job states synchronized with SQLite. No fake previews.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <select
                  value={queueStatusFilter}
                  onChange={(e) => setQueueStatusFilter(e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    color: 'white',
                    border: '1px solid var(--border-glass)',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                >
                  <option value="all">All Statuses ({jobs.length})</option>
                  <option value="succeeded">Succeeded ({jobStats.completed})</option>
                  <option value="failed">Failed ({jobStats.failed})</option>
                  <option value="unsupported">Unsupported ({jobStats.unsupported})</option>
                  <option value="queued">Queued / Active ({jobStats.active})</option>
                </select>

                <button
                  className="btn-glass"
                  onClick={onClearCompletedJobs}
                  style={{ fontSize: '12px' }}
                >
                  <Trash2 size={14} />
                  <span>Clear Finished</span>
                </button>
              </div>
            </div>

            {filteredJobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                No jobs match the current filter.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Conversion</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Details</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    let badgeClass = 'status-queued';
                    if (job.status === 'SUCCEEDED') badgeClass = 'status-completed';
                    else if (job.status === 'RUNNING') badgeClass = 'status-processing';
                    else if (job.status === 'FAILED') badgeClass = 'status-failed';
                    else if (job.status === 'UNSUPPORTED') badgeClass = 'status-unsupported';
                    else if (job.status === 'CANCELLED') badgeClass = 'status-cancelled';

                    return (
                      <tr key={job.id}>
                        <td>
                          <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>{job.sourceFileName}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {job.sourcePath}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: '700' }}>
                            .{job.inputFormat.toUpperCase()} &rarr; .{job.outputFormat.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge ${badgeClass}`}>
                            {job.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                          {job.durationMs ? `${job.durationMs}ms` : '—'}
                        </td>
                        <td style={{ fontSize: '12px', maxWidth: '300px' }}>
                          {job.errorMessage ? (
                            <span style={{ color: 'var(--status-failed)' }}>{job.errorMessage}</span>
                          ) : job.outputPath ? (
                            <span style={{ color: 'var(--status-completed)', fontSize: '11px' }}>
                              Output written successfully
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-dim)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {job.outputPath && (
                              <button
                                className="btn-glass"
                                onClick={() => window.radialAPI?.showItemInFolder(job.outputPath!)}
                                title="Show in Windows Explorer"
                                style={{ padding: '4px 8px' }}
                              >
                                <ExternalLink size={13} />
                              </button>
                            )}

                            {(job.status === 'FAILED' || job.status === 'UNSUPPORTED') && (
                              <button
                                className="btn-glass"
                                onClick={() => onRetryJob(job.id)}
                                title="Retry conversion"
                                style={{ padding: '4px 8px' }}
                              >
                                <RotateCcw size={13} color="#f97316" />
                              </button>
                            )}

                            {(job.status === 'QUEUED' || job.status === 'RUNNING') && (
                              <button
                                className="btn-glass"
                                onClick={() => onCancelJob(job.id)}
                                title="Cancel Job"
                                style={{ padding: '4px 8px' }}
                              >
                                <XCircle size={13} color="#ef4444" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 3: APPROVED FOLDERS */}
        {activeTab === 'folders' && (
          <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Approved Folders Registry</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  All file conversions and queries are strictly confined to these user-approved folders.
                </p>
              </div>

              <button className="btn-glass btn-primary" onClick={onAddFolder}>
                <FolderPlus size={15} />
                <span>Add Approved Folder</span>
              </button>
            </div>

            {folders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                No folders approved yet. Click &ldquo;Add Approved Folder&rdquo; to begin indexing files.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {folders.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '12px',
                      border: '1px solid var(--border-glass-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <FolderOpen size={24} color={f.enabled ? '#f97316' : '#64748b'} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '700' }}>{f.name}</span>
                          <span
                            className="status-badge"
                            style={{
                              background: f.enabled ? 'var(--status-completed-bg)' : 'rgba(100, 116, 139, 0.2)',
                              color: f.enabled ? 'var(--status-completed)' : 'var(--text-muted)'
                            }}
                          >
                            {f.enabled ? 'Watcher Active' : 'Disabled'}
                          </span>
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{f.path}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {f.file_count} files
                      </span>

                      <button
                        className="btn-glass"
                        onClick={() => onRescanFolder(f.id)}
                        title="Rescan folder"
                        style={{ padding: '6px 10px' }}
                      >
                        <RefreshCw size={13} />
                        <span>Rescan</span>
                      </button>

                      <button
                        className="btn-glass"
                        onClick={() => onToggleFolder(f.id, f.enabled)}
                        style={{ padding: '6px 10px' }}
                      >
                        {f.enabled ? 'Pause' : 'Resume'}
                      </button>

                      <button
                        className="btn-glass"
                        onClick={() => onRemoveFolder(f.id)}
                        title="Remove approved folder"
                        style={{ padding: '6px 10px', color: 'var(--status-failed)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: FILE EXPLORER */}
        {activeTab === 'explorer' && (
          <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Indexed File Explorer</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Search indexed files across approved folders.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-dim)' }} />
                  <input
                    type="text"
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: 'white',
                      border: '1px solid var(--border-glass)',
                      padding: '8px 12px 8px 32px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      width: '240px'
                    }}
                  />
                </div>

                <select
                  value={explorerCategoryFilter}
                  onChange={(e) => setExplorerCategoryFilter(e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    color: 'white',
                    border: '1px solid var(--border-glass)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                >
                  <option value="all">All Categories</option>
                  <option value="image">Images</option>
                  <option value="document">Documents</option>
                  <option value="video">Videos</option>
                </select>
              </div>
            </div>

            {filteredExplorerFiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                No files found matching criteria.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Size</th>
                    <th>Path</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExplorerFiles.map((file) => (
                    <tr key={file.id}>
                      <td style={{ fontWeight: '600' }}>{file.name}</td>
                      <td>
                        <span className="status-badge" style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' }}>
                          {file.category}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                        {formatBytes(file.size_bytes)}
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-dim)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.path}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="btn-glass"
                            onClick={() => window.radialAPI?.openPath(file.path)}
                            title="Open file"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            Open
                          </button>
                          <button
                            className="btn-glass"
                            onClick={() => window.radialAPI?.showItemInFolder(file.path)}
                            title="Reveal in Explorer"
                            style={{ padding: '4px 8px' }}
                          >
                            <ExternalLink size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 5: SETTINGS */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="glass-card">
              <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>Desktop Radial Widget Preferences</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Configure floating widget behavior on the Windows desktop.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-glass-subtle)' }}>
                  <div>
                    <strong style={{ fontSize: '13px' }}>Floating Widget Visibility</strong>
                    <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Show or hide the compact draggable radial widget on the desktop.</p>
                  </div>
                  <button className="btn-glass btn-primary" onClick={onToggleWidgetWindow}>
                    Toggle Widget
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-glass-subtle)' }}>
                  <div>
                    <strong style={{ fontSize: '13px' }}>Reset Widget Position</strong>
                    <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                      Relocate floating widget back to safe default coordinates on primary display.
                    </p>
                  </div>
                  <button
                    className="btn-glass"
                    onClick={() => {
                      if (window.radialAPI?.saveWidgetPosition) {
                        window.radialAPI.saveWidgetPosition(100, 100);
                        alert('Widget position reset. It will reappear on primary display.');
                      }
                    }}
                  >
                    Reset Position
                  </button>
                </div>
              </div>
            </div>

            <div className="glass-card">
              <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>System Architecture & Security Integrity</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Radial File Studio operates fully local-first with zero cloud telemetry.
              </p>

              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                <div>&bull; <strong>Storage:</strong> SQLite with WAL mode & atomic snapshot persistence.</div>
                <div>&bull; <strong>Conversion Engines:</strong> Sharp (Images) &bull; pdf-parse (Document text extraction).</div>
                <div>&bull; <strong>Filesystem Protection:</strong> Strict containment checks via canonical realpath resolution. Traversal & symlink escapes are actively blocked.</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
