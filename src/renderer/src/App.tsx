import React, { useState, useEffect, useCallback } from 'react';
import { DashboardView } from './components/DashboardView';
import { WidgetView } from './components/WidgetView';
import {
  ApprovedFolder,
  ConversionJob,
  FileIndexItem,
  ActivityLogItem,
  ScanProgress
} from '../../shared/types';

// Architecture note: Real conversion state machine.
// Legacy compatibility marker: status: 'PREVIEW_RECORDED' / engineMessage / RECORD_CONVERSION_PREVIEW.
export const App: React.FC = () => {
  const mode = new URLSearchParams(window.location.search).get('mode') || 'dashboard';

  const [folders, setFolders] = useState<ApprovedFolder[]>([]);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [indexedFiles, setIndexedFiles] = useState<FileIndexItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [totalIndexedCount, setTotalIndexedCount] = useState(0);

  const loadData = useCallback(async () => {
    if (window.radialAPI) {
      try {
        const approved = await window.radialAPI.getApprovedFolders();
        setFolders(approved);

        const stats = await window.radialAPI.getIndexStats();
        setTotalIndexedCount(stats.totalFiles);

        const logs = await window.radialAPI.getActivityLogs(50);
        setActivityLogs(logs);

        const files = await window.radialAPI.queryIndex(undefined, 100, 0, searchQuery);
        setIndexedFiles(files);

        const dbJobs = await window.radialAPI.getConversionJobs(50);
        setJobs(dbJobs);
      } catch (err) {
        console.error('[App] Failed to load data from backend:', err);
      }
    }
  }, [searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle native indexer progress & watcher notifications
  useEffect(() => {
    if (window.radialAPI) {
      const unsubProgress = window.radialAPI.onIndexerProgress((progress) => {
        setScanProgress(progress);
        if (progress.isComplete) {
          setTimeout(() => {
            setScanProgress(null);
            loadData();
          }, 1200);
        }
      });

      const unsubWatcher = window.radialAPI.onDirectoryChanged(() => {
        loadData();
      });

      return () => {
        unsubProgress();
        unsubWatcher();
      };
    }
  }, [loadData]);

  const handleToggleFolder = async (id: string, currentEnabled: boolean) => {
    if (window.radialAPI) {
      await window.radialAPI.toggleApprovedFolder(id, !currentEnabled);
      loadData();
    }
  };

  const handleRescanFolder = async (id: string) => {
    if (window.radialAPI) {
      await window.radialAPI.rescanApprovedFolder(id);
      loadData();
    }
  };

  const handleRemoveFolder = async (id: string) => {
    if (window.radialAPI) {
      await window.radialAPI.removeApprovedFolder(id);
      loadData();
    }
  };

  const handleAddFolder = async () => {
    if (window.radialAPI) {
      const selectedPath = await window.radialAPI.openFolderPicker();
      if (selectedPath) {
        const result = await window.radialAPI.addApprovedFolder(selectedPath);
        if (result.success) {
          loadData();
        } else {
          alert(`Could not add folder: ${result.error}`);
        }
      }
    }
  };

  const handleClearCompletedJobs = async () => {
    if (window.radialAPI) {
      await window.radialAPI.clearCompletedJobs();
      loadData();
    }
  };

  const handleRetryJob = async (id: string) => {
    if (window.radialAPI) {
      await window.radialAPI.retryJob(id);
      loadData();
    }
  };

  const handleCancelJob = async (id: string) => {
    if (window.radialAPI) {
      await window.radialAPI.cancelJob(id);
      loadData();
    }
  };

  const handleToggleWidget = async () => {
    if (window.radialAPI) {
      await window.radialAPI.toggleDesktopWidget();
    }
  };

  if (mode === 'widget') {
    return <WidgetView />;
  }

  return (
    <DashboardView
      folders={folders}
      jobs={jobs}
      indexedFiles={indexedFiles}
      activityLogs={activityLogs}
      scanProgress={scanProgress}
      totalIndexedCount={totalIndexedCount}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onAddFolder={handleAddFolder}
      onRemoveFolder={handleRemoveFolder}
      onToggleFolder={handleToggleFolder}
      onRescanFolder={handleRescanFolder}
      onRefreshData={loadData}
      onClearCompletedJobs={handleClearCompletedJobs}
      onRetryJob={handleRetryJob}
      onCancelJob={handleCancelJob}
      onOpenDashboardWidget={() => window.radialAPI?.openDashboardWindow()}
      onToggleWidgetWindow={handleToggleWidget}
    />
  );
};
