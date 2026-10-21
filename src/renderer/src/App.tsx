import React, { useReducer, useState, useEffect } from 'react';
import { RadialWidget } from './components/RadialWidget';
import { DashboardModal } from './components/DashboardModal';
import {
  radialStateReducer,
  INITIAL_STATE_CONTEXT
} from './core/RadialStateMachine';
import {
  SelectedFolder,
  ConversionJob,
  RadialSector
} from '../../shared/types';

export const App: React.FC = () => {
  const [context, dispatch] = useReducer(radialStateReducer, INITIAL_STATE_CONTEXT);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);

  // Common Windows folders onboarding state (explicit user approval)
  const [folders, setFolders] = useState<SelectedFolder[]>([
    {
      id: 'f-desktop',
      path: 'C:\\Users\\User\\Desktop',
      name: 'Desktop',
      enabled: true,
      addedAt: Date.now()
    },
    {
      id: 'f-documents',
      path: 'C:\\Users\\User\\Documents',
      name: 'Documents',
      enabled: true,
      addedAt: Date.now()
    },
    {
      id: 'f-downloads',
      path: 'C:\\Users\\User\\Downloads',
      name: 'Downloads',
      enabled: false,
      addedAt: Date.now()
    },
    {
      id: 'f-pictures',
      path: 'C:\\Users\\User\\Pictures',
      name: 'Pictures',
      enabled: false,
      addedAt: Date.now()
    },
    {
      id: 'f-videos',
      path: 'C:\\Users\\User\\Videos',
      name: 'Videos',
      enabled: false,
      addedAt: Date.now()
    }
  ]);

  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [watcherLogs, setWatcherLogs] = useState<
    Array<{ dirPath: string; eventType: string; filename: string; timestamp: number }>
  >([]);

  // Subscribe to native directory change events if available
  useEffect(() => {
    if (window.radialAPI) {
      const unsubscribe = window.radialAPI.onDirectoryChanged((event) => {
        setWatcherLogs((prev) => [
          ...prev,
          {
            dirPath: '',
            eventType: event.eventType,
            filename: event.filename,
            timestamp: Date.now()
          }
        ]);
      });

      return () => unsubscribe();
    }
  }, []);

  // Sync folder watchers with native backend
  useEffect(() => {
    if (window.radialAPI) {
      folders.forEach((f) => {
        if (f.enabled) {
          window.radialAPI?.watchDirectory(f.path);
        } else {
          window.radialAPI?.unwatchDirectory(f.path);
        }
      });
    }
  }, [folders]);

  const handleToggleFolder = (id: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f))
    );
  };

  const handleAddCustomFolder = async () => {
    if (window.radialAPI) {
      const selectedPath = await window.radialAPI.openFolderPicker();
      if (selectedPath) {
        const folderName = selectedPath.split(/[\\/]/).pop() || selectedPath;
        setFolders((prev) => [
          ...prev,
          {
            id: `f-${Date.now()}`,
            path: selectedPath,
            name: folderName,
            enabled: true,
            addedAt: Date.now()
          }
        ]);
      }
    } else {
      // Browser fallback simulation
      const mockPath = 'C:\\Users\\User\\Projects\\MyAssets';
      setFolders((prev) => [
        ...prev,
        {
          id: `f-${Date.now()}`,
          path: mockPath,
          name: 'MyAssets',
          enabled: true,
          addedAt: Date.now()
        }
      ]);
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

    // Local conversion execution simulation (validating output before marking succeeded)
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
    }, 900);
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
        onAddCustomFolder={handleAddCustomFolder}
        jobs={jobs}
        watcherLogs={watcherLogs}
      />
    </>
  );
};
