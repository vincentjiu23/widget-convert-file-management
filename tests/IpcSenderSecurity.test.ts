import { describe, it, expect } from 'vitest';
import { isTrustedIpcSender } from '../src/main/ipc';
import { BrowserWindow } from 'electron';

describe('Task A & B: IPC Sender Security & Argument Verification', () => {
  it('rejects IPC events when window is null', () => {
    const fakeEvent = {
      sender: {} as any
    } as Electron.IpcMainInvokeEvent;

    expect(isTrustedIpcSender(fakeEvent, null)).toBe(false);
  });

  it('rejects IPC events when window is destroyed', () => {
    const fakeWin = {
      isDestroyed: () => true,
      webContents: {}
    } as unknown as BrowserWindow;

    const fakeEvent = {
      sender: fakeWin.webContents
    } as Electron.IpcMainInvokeEvent;

    expect(isTrustedIpcSender(fakeEvent, fakeWin)).toBe(false);
  });

  it('rejects IPC events when event.sender does not match window.webContents', () => {
    const actualWebContents = { id: 1 };
    const attackerWebContents = { id: 2 };

    const fakeWin = {
      isDestroyed: () => false,
      webContents: actualWebContents
    } as unknown as BrowserWindow;

    const spoofedEvent = {
      sender: attackerWebContents
    } as Electron.IpcMainInvokeEvent;

    expect(isTrustedIpcSender(spoofedEvent, fakeWin)).toBe(false);
  });

  it('rejects IPC events when senderFrame does not match mainFrame (e.g. untrusted iframe or child frame)', () => {
    const actualWebContents = {
      id: 1,
      mainFrame: { frameId: 100 }
    };

    const fakeWin = {
      isDestroyed: () => false,
      webContents: actualWebContents
    } as unknown as BrowserWindow;

    const iframeEvent = {
      sender: actualWebContents,
      senderFrame: { frameId: 999 } // secondary iframe
    } as unknown as Electron.IpcMainInvokeEvent;

    expect(isTrustedIpcSender(iframeEvent, fakeWin)).toBe(false);
  });

  it('accepts legitimate IPC events originating from mainFrame of active main window', () => {
    const mainFrameObj = { frameId: 100 };
    const actualWebContents = {
      id: 1,
      mainFrame: mainFrameObj
    };

    const fakeWin = {
      isDestroyed: () => false,
      webContents: actualWebContents
    } as unknown as BrowserWindow;

    const legitimateEvent = {
      sender: actualWebContents,
      senderFrame: mainFrameObj
    } as unknown as Electron.IpcMainInvokeEvent;

    expect(isTrustedIpcSender(legitimateEvent, fakeWin)).toBe(true);
  });
});
