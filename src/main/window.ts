import { BrowserWindow, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createFloatingWidgetWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const windowSize = 820;
  const x = Math.round((screenWidth - windowSize) / 2);
  const y = Math.round((screenHeight - windowSize) / 2);

  // Preload path resolution: support both .js and .mjs build outputs
  let preloadPath = path.join(__dirname, '../preload/index.js');
  if (!fs.existsSync(preloadPath)) {
    const mjsPath = path.join(__dirname, '../preload/index.mjs');
    if (fs.existsSync(mjsPath)) {
      preloadPath = mjsPath;
    }
  }

  const win = new BrowserWindow({
    width: windowSize,
    height: windowSize,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    show: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}
