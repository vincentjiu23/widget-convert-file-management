import React, { useReducer, useState, useEffect, useCallback } from 'react';
import { RadialWidget } from './components/RadialWidget';
import { DashboardModal } from './components/DashboardModal';
import {
  radialStateReducer,
  INITIAL_STATE_CONTEXT
} from './core/RadialStateMachine';
import {
  ApprovedFolder,
  ConversionJob,
  RadialSector,
  FileIndexItem,
  ActivityLogItem,
  ScanProgress
} from '../../shared/types';

export const App: React.FC = () => {
  const [context, dispatch] = useReducer(radialStateReducer, INITIAL_STATE_CONTEXT);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);

  const [folders, setFolders] = useState<ApprovedFolder[]>([]);
  const [indexedFiles, setIndexedFiles] = useState<FileIndexItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [totalIndexedCount, setTotalIndexedCount] = useState(0);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);

  // Load authoritative folders and stats from Main Process SQLite
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
        // Filesystem event received: refresh index and logs
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

  const handleAddCustomFolder = async () => {
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

  const handleExecuteDrop = (file: File, sector: RadialSector) => {
    const rawPath = window.radialAPI?.getPathForFile(file) || file.name;
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const outputFilename = `${baseName}.${sector.format}`;
    const outputPath = rawPath.includes('\\')
      ? rawPath.replace(/[^\\]+$/, outputFilename)
      : outputFilename;

    const jobId = `job-${Date.now()}`;
    const newJob: ConversionJob = {
      id: jobId,
      sourcePath: rawPath,
      sourceFileName: file.name,
      inputFormat: file.name.split('.').pop() || '',
      outputFormat: sector.format,
      status: 'RUNNING',
      progress: 0,
      createdAt: Date.now(),
      startedAt: Date.now(),
      outputPath
    };

    setJobs((prev) => [newJob, ...prev]);
    dispatch({ type: 'JOB_STARTED', jobId });

    // Output validation lifecycle simulation
    setTimeout(() => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'SUCCEEDED',
                progress: 100,
                completedAt: Date.now()
              }
            : j
        )
      );

      dispatch({
        type: 'JOB_COMPLETED',
        outputPath
      });
    }, 800);
  };

  return (
    <>
      <RadialWidget
        context={context}
        dispatch={dispatch}
        onExecuteDrop={handleExecuteDrop}
        onOpenDashboard={() => setIsDashboardOpen(true)}
      />

      <DashboardModal
        isOpen={isDashboardOpen}
        onClose={() => setIsDashboardOpen(false)}
        folders={folders}
        onToggleFolder={handleToggleFolder}
        onRescanFolder={handleRescanFolder}
        onAddCustomFolder={handleAddCustomFolder}
        onRemoveFolder={handleRemoveFolder}
        jobs={jobs}
        indexedFiles={indexedFiles}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activityLogs={activityLogs}
        scanProgress={scanProgress}
        totalIndexedCount={totalIndexedCount}
      />
    </>
  );
};
