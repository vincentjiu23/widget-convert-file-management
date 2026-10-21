import { describe, it, expect, beforeEach } from 'vitest';
import { FolderPermissionRegistry } from '../src/main/security/FolderPermissionRegistry';
import { DatabaseService } from '../src/main/database/DatabaseService';
import path from 'path';
import fs from 'fs';

describe('Task C: IPC & Filesystem Security Authority Suite', () => {
  let db: DatabaseService;
  let registry: FolderPermissionRegistry;
  const tempDbPath = path.join(__dirname, 'temp_test_sec.sqlite');

  beforeEach(async () => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    db = new DatabaseService(tempDbPath);
    await db.initialize();
    registry = new FolderPermissionRegistry(db);
  });

  it('canonicalizes Windows paths and normalizes drive letters', () => {
    const raw = 'c:\\users\\test\\documents\\..\\pictures\\';
    const canonical = registry.canonicalize(raw);
    expect(canonical).toBe('C:\\users\\test\\pictures');
  });

  it('strips null-byte injections from candidate paths', () => {
    const malicious = 'C:\\Users\\User\\safe\0\\..\\..\\Windows\\malicious.exe';
    const canonical = registry.canonicalize(malicious);
    expect(canonical).not.toContain('\0');
  });

  it('prohibits entire drive root scanning (e.g. C:\\)', () => {
    const check1 = registry.isSystemOrRootPath('C:\\');
    expect(check1.isForbidden).toBe(true);
    expect(check1.reason).toContain('Entire drive root scanning is prohibited');

    const check2 = registry.isSystemOrRootPath('D:');
    expect(check2.isForbidden).toBe(true);
  });

  it('prohibits protected Windows system directories', () => {
    const sysWin = registry.isSystemOrRootPath('C:\\Windows');
    expect(sysWin.isForbidden).toBe(true);

    const sysWin32 = registry.isSystemOrRootPath('C:\\Windows\\System32\\calc.exe');
    expect(sysWin32.isForbidden).toBe(true);

    const progFiles = registry.isSystemOrRootPath('C:\\Program Files\\app');
    expect(progFiles.isForbidden).toBe(true);
  });

  it('strictly validates path scope against approved folders and blocks path traversal', () => {
    // Add approved folder directly to db
    db.addApprovedFolder({
      id: 'f-docs',
      path: 'C:\\Users\\User\\Documents',
      name: 'Documents',
      enabled: true
    });
    registry.refreshCache();

    // 1. Valid file inside approved folder
    const valid1 = registry.isPathWithinApprovedFolder('C:\\Users\\User\\Documents\\quarterly_report.pdf');
    expect(valid1.isValid).toBe(true);
    expect(valid1.matchedFolder?.id).toBe('f-docs');

    // 2. Valid file in subfolder
    const validSub = registry.isPathWithinApprovedFolder('C:\\Users\\User\\Documents\\2026\\Q1\\sheet.xlsx');
    expect(validSub.isValid).toBe(true);

    // 3. File in unapproved folder
    const unapproved = registry.isPathWithinApprovedFolder('C:\\Users\\User\\Downloads\\setup.exe');
    expect(unapproved.isValid).toBe(false);
    expect(unapproved.error).toContain('PERMISSION_DENIED');

    // 4. Path traversal attempt escaping approved root
    const traversal = registry.isPathWithinApprovedFolder('C:\\Users\\User\\Documents\\..\\..\\Windows\\System32\\cmd.exe');
    expect(traversal.isValid).toBe(false);
    expect(traversal.error).toContain('PERMISSION_DENIED');
  });

  it('respects disabled/toggled folders', () => {
    db.addApprovedFolder({
      id: 'f-pics',
      path: 'C:\\Users\\User\\Pictures',
      name: 'Pictures',
      enabled: false // Disabled by user
    });
    registry.refreshCache();

    const check = registry.isPathWithinApprovedFolder('C:\\Users\\User\\Pictures\\photo.jpg');
    expect(check.isValid).toBe(false);
  });
});
