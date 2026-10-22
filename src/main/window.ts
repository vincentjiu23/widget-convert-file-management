import { BrowserWindow, screen, Rectangle } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getPreloadPath(): string {
  let preloadPath = path.join(__dirname, '../preload/index.js');
  if (!fs.existsSync(preloadPath)) {
    const mjsPath = path.join(__dirname, '../preload/index.mjs');
    if (fs.existsSync(mjsPath)) {
      preloadPath = mjsPath;
    }
  }
  return preloadPath;
}

/**
 * Validates whether a given rectangular area is visible on any currently connected display.
 * If invalid or disconnected, falls back to a safe default position on the primary display.
 */
export function getSafeWidgetBounds(
  saved?: { x?: number; y?: number; width?: number; height?: number },
  defaultSize = 380
): Rectangle {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const primaryWorkArea = primaryDisplay.workArea;

  const width = defaultSize;
  const height = defaultSize;

  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    // Check if the center of saved bounds is within any active display
    const centerX = saved.x + width / 2;
    const centerY = saved.y + height / 2;

    const isVisible = displays.some((d) => {
      const b = d.bounds;
      return (
        centerX >= b.x &&
        centerX <= b.x + b.width &&
        centerY >= b.y &&
        centerY <= b.y + b.height
      );
    });

    if (isVisible) {
      return {
        x: Math.round(saved.x),
        y: Math.round(saved.y),
        width,
        height
      };
    }
  }

  // Default: Bottom-right corner of primary display with 30px padding
  return {
    x: Math.round(primaryWorkArea.x + primaryWorkArea.width - width - 30),
    y: Math.round(primaryWorkArea.y + primaryWorkArea.height - height - 30),
    width,
    height
  };
}

/**
 * Creates the primary application dashboard window (App Mode).
 * Resizable, standard Windows window, fully non-overlapping with high-contrast glassmorphism.
 */
export function createDashboardWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const width = Math.min(1160, Math.round(screenWidth * 0.85));
  const height = Math.min(780, Math.round(screenHeight * 0.85));
  const x = Math.round((screenWidth - width) / 2);
  const y = Math.round((screenHeight - height) / 2);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 620,
    x,
    y,
    frame: true,
    title: 'Radial File Studio',
    show: false,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}

/**
 * Creates the compact, floating desktop radial widget window (Desktop Widget Mode).
 * 380x380 frameless transparent window with validated screen bounds.
 */
export function createFloatingWidgetWindow(
  savedBounds?: { x?: number; y?: number; width?: number; height?: number },
  alwaysOnTop = false
): BrowserWindow {
  const bounds = getSafeWidgetBounds(savedBounds, 380);

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    alwaysOnTop,
    resizable: false,
    hasShadow: false,
    show: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}
