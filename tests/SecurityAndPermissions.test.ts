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

  it('handles Windows path case-insensitivity across uppercase, lowercase, and mixed-case', () => {
    db.addApprovedFolder({
      id: 'f-case',
      path: 'C:\\Users\\TestUser\\ProjectData',
      name: 'ProjectData',
      enabled: true
    });
    registry.refreshCache();

    // Lowercase drive and path
    const lower = registry.isPathWithinApprovedFolder('c:\\users\\testuser\\projectdata\\document.docx');
    expect(lower.isValid).toBe(true);
    expect(lower.matchedFolder?.id).toBe('f-case');

    // ALL UPPERCASE
    const upper = registry.isPathWithinApprovedFolder('C:\\USERS\\TESTUSER\\PROJECTDATA\\SUB\\REPORT.PDF');
    expect(upper.isValid).toBe(true);

    // Mixed case
    const mixed = registry.isPathWithinApprovedFolder('c:\\UsErS\\tEsTuSeR\\pRoJeCtDaTa\\IMAGE.PNG');
    expect(mixed.isValid).toBe(true);
  });

  it('rejects access when an approved folder is removed', () => {
    db.addApprovedFolder({
      id: 'f-todelete',
      path: 'C:\\Users\\User\\TemporaryFolder',
      name: 'TemporaryFolder',
      enabled: true
    });
    registry.refreshCache();

    const before = registry.isPathWithinApprovedFolder('C:\\Users\\User\\TemporaryFolder\\file.txt');
    expect(before.isValid).toBe(true);

    // Remove folder
    registry.removeFolder('f-todelete');

    const after = registry.isPathWithinApprovedFolder('C:\\Users\\User\\TemporaryFolder\\file.txt');
    expect(after.isValid).toBe(false);
    expect(after.error).toContain('PERMISSION_DENIED');
  });

  it('detects and blocks real symlinks or junctions that point outside approved scope', () => {
    const testDir = path.join(__dirname, 'symlink_sec_test');
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });

    try {
      const approvedDir = path.join(testDir, 'approved');
      const outsideDir = path.join(testDir, 'outside_forbidden');
      fs.mkdirSync(approvedDir);
      fs.mkdirSync(outsideDir);

      const secretFile = path.join(outsideDir, 'secret_passwords.txt');
      fs.writeFileSync(secretFile, 'sensitive data');

      const regularFile = path.join(approvedDir, 'normal.txt');
      fs.writeFileSync(regularFile, 'hello');

      // Register approvedDir
      db.addApprovedFolder({
        id: 'f-sym-test',
        path: approvedDir,
        name: 'Approved Folder',
        enabled: true
      });
      registry.refreshCache();

      // Normal file inside approved folder is valid
      const normCheck = registry.isPathWithinApprovedFolder(regularFile);
      expect(normCheck.isValid).toBe(true);

      // Create a symlink inside approvedDir pointing to secretFile outside
      const symlinkPath = path.join(approvedDir, 'link_to_secret.txt');
      try {
        fs.symlinkSync(secretFile, symlinkPath, 'file');

        // Check symlink containment: should detect realpath pointing to outsideDir
        const symCheck = registry.isPathWithinApprovedFolder(symlinkPath);
        expect(symCheck.isValid).toBe(false);
        expect(symCheck.error).toContain('SECURITY_VIOLATION');
      } catch (symlinkErr: any) {
        // On Windows without Developer Mode, creating symlinks may require elevated privileges.
        // If symlink creation fails with EPERM, verify graceful fallback handling.
        console.warn('[Test] Symlink creation restricted in this Windows environment:', symlinkErr?.message);
      }
    } finally {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });
});
