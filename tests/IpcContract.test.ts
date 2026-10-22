import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * IPC Contract Coverage Test
 * Verifies 1:1 parity between preload API methods and main-process IPC handler registrations.
 * If a preload method invokes a channel that has no main handler, the app will silently hang.
 */
describe('IPC Contract: Preload ↔ Main Handler Parity', () => {
  const preloadSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'preload', 'index.ts'),
    'utf-8'
  );
  const ipcSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ipc.ts'),
    'utf-8'
  );

  // Extract all IPC channels used in preload (ipcRenderer.invoke and ipcRenderer.send/on)
  function extractPreloadChannels(source: string): string[] {
    const invokeRe = /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g;
    const sendRe = /ipcRenderer\.send\(\s*['"]([^'"]+)['"]/g;
    const onRe = /ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g;
    const channels = new Set<string>();
    for (const re of [invokeRe, sendRe, onRe]) {
      let m;
      while ((m = re.exec(source)) !== null) {
        channels.add(m[1]);
      }
    }
    return [...channels].sort();
  }

  // Extract all IPC channels handled in main (ipcMain.handle and ipcMain.on)
  function extractMainChannels(source: string): string[] {
    const handleRe = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
    const onRe = /ipcMain\.on\(\s*['"]([^'"]+)['"]/g;
    const channels = new Set<string>();
    for (const re of [handleRe, onRe]) {
      let m;
      while ((m = re.exec(source)) !== null) {
        channels.add(m[1]);
      }
    }
    return [...channels].sort();
  }

  const preloadChannels = extractPreloadChannels(preloadSource);
  const mainChannels = extractMainChannels(ipcSource);

  // Channels that are sent FROM main TO renderer (main -> renderer push notifications)
  // These are emitted by main via webContents.send(), not handled by ipcMain
  const mainToRendererPushChannels = ['fs:directory-changed', 'indexer:progress'];

  it('should have at least 10 preload channels defined', () => {
    expect(preloadChannels.length).toBeGreaterThanOrEqual(10);
  });

  it('every preload invoke/send channel must have a corresponding main handler', () => {
    const missing: string[] = [];
    for (const ch of preloadChannels) {
      // Skip channels that are push-from-main (preload listens via ipcRenderer.on)
      if (mainToRendererPushChannels.includes(ch)) continue;
      if (!mainChannels.includes(ch)) {
        missing.push(ch);
      }
    }
    expect(
      missing,
      `Preload channels without main handlers: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every main handler should be invoked by at least one preload method', () => {
    const unused: string[] = [];
    for (const ch of mainChannels) {
      if (!preloadChannels.includes(ch)) {
        unused.push(ch);
      }
    }
    expect(
      unused,
      `Main handlers without preload callers: ${unused.join(', ')}`
    ).toEqual([]);
  });

  it('preload registers listeners for main-to-renderer push channels', () => {
    for (const pushCh of mainToRendererPushChannels) {
      expect(
        preloadChannels,
        `Missing preload listener for push channel: ${pushCh}`
      ).toContain(pushCh);
    }
  });

  it('sender validation (verifyIpcSender) is present on ALL IPC channels (handles and listeners)', () => {
    const allChannels = [
      'folders:getApproved',
      'folders:add',
      'folders:remove',
      'folders:toggle',
      'folders:rescan',
      'index:query',
      'index:stats',
      'activity:getLogs',
      'dialog:openDirectory',
      'dialog:openFile',
      'shell:openPath',
      'shell:showItemInFolder',
      'window:setIgnoreMouseEvents',
      'window:minimize',
      'window:close'
    ];

    for (const ch of allChannels) {
      // Find the handler block and check it contains verifyIpcSender
      const handlerRe = new RegExp(
        `ipcMain\\.(handle|on)\\(\\s*'${ch.replace(':', '\\:')}'[\\s\\S]*?verifyIpcSender`,
        'm'
      );
      expect(
        handlerRe.test(ipcSource),
        `Handler or listener for channel '${ch}' MUST call verifyIpcSender`
      ).toBe(true);
    }
  });
});
