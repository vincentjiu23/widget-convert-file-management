import path from 'path';
import fs from 'fs';
import { DatabaseService, ApprovedFolderRecord } from '../database/DatabaseService';

export interface PathValidationResult {
  isValid: boolean;
  canonicalPath: string;
  error?: string;
  matchedFolder?: ApprovedFolderRecord;
}

export class FolderPermissionRegistry {
  private databaseService: DatabaseService;
  private cachedApprovedFolders: Map<string, ApprovedFolderRecord> = new Map();

  // Protected Windows system directories that must never be indexed or accessed
  private blockedSystemPrefixes: string[] = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\$Recycle.Bin',
    'C:\\System Volume Information'
  ];

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
    this.refreshCache();
  }

  public refreshCache(): void {
    const folders = this.databaseService.getApprovedFolders();
    this.cachedApprovedFolders.clear();
    for (const f of folders) {
      this.cachedApprovedFolders.set(this.canonicalize(f.path).toLowerCase(), f);
    }
  }

  /**
   * Canonicalizes a Windows path: resolves relatives, removes trailing slashes, normalizes separators
   */
  public canonicalize(rawPath: string): string {
    if (!rawPath || typeof rawPath !== 'string') return '';
    // Strip null bytes
    const clean = rawPath.replace(/\0/g, '');
    let resolved = path.resolve(path.normalize(clean));

    // Normalize Windows drive letter to uppercase (e.g., c:\ -> C:\)
    if (/^[a-zA-Z]:/.test(resolved)) {
      resolved = resolved[0].toUpperCase() + resolved.slice(1);
    }

    // Strip trailing separator unless root directory (e.g. C:\)
    if (resolved.length > 3 && resolved.endsWith(path.sep)) {
      resolved = resolved.slice(0, -1);
    }

    return resolved;
  }

  /**
   * Checks if path is a root drive or forbidden system directory
   */
  public isSystemOrRootPath(canonicalPath: string): { isForbidden: boolean; reason?: string } {
    if (/^[A-Z]:\\?$/i.test(canonicalPath)) {
      return {
        isForbidden: true,
        reason: 'Entire drive root scanning is prohibited. Please select specific user folders.'
      };
    }

    for (const prefix of this.blockedSystemPrefixes) {
      if (
        canonicalPath.toLowerCase() === prefix.toLowerCase() ||
        canonicalPath.toLowerCase().startsWith(prefix.toLowerCase() + path.sep)
      ) {
        return {
          isForbidden: true,
          reason: `Access to protected Windows system path (${prefix}) is denied.`
        };
      }
    }

    return { isForbidden: false };
  }

  /**
   * Adds an approved folder to the authoritative registry after deep validation
   */
  public addFolder(rawPath: string, name?: string): { success: boolean; folder?: ApprovedFolderRecord; error?: string } {
    const canonical = this.canonicalize(rawPath);

    if (!canonical) {
      return { success: false, error: 'INVALID_PATH: Path is empty or malformed' };
    }

    // Check system directory bounds
    const sysCheck = this.isSystemOrRootPath(canonical);
    if (sysCheck.isForbidden) {
      return { success: false, error: `SECURITY_VIOLATION: ${sysCheck.reason}` };
    }

    // Verify directory exists on disk and check reparse point target
    try {
      const stat = fs.statSync(canonical);
      if (!stat.isDirectory()) {
        return { success: false, error: 'NOT_A_DIRECTORY: Specified path is not a directory' };
      }
      const real = fs.realpathSync(canonical);
      const realSysCheck = this.isSystemOrRootPath(this.canonicalize(real));
      if (realSysCheck.isForbidden) {
        return {
          success: false,
          error: `SECURITY_VIOLATION: Target folder symlink/junction points to prohibited system path (${realSysCheck.reason})`
        };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `DIRECTORY_NOT_FOUND: ${errorMsg}` };
    }

    const folderId = `fld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const folderName = name || path.basename(canonical) || canonical;

    this.databaseService.addApprovedFolder({
      id: folderId,
      path: canonical,
      name: folderName,
      enabled: true
    });

    this.databaseService.logActivity({
      event_type: 'FOLDER_ADDED',
      resource_type: 'FOLDER',
      resource_id: folderId,
      summary: `Approved folder added: ${folderName} (${canonical})`
    });

    this.refreshCache();
    const created = this.cachedApprovedFolders.get(canonical.toLowerCase());
    return { success: true, folder: created };
  }

  public removeFolder(folderId: string): boolean {
    const folder = this.databaseService.getApprovedFolderById(folderId);
    if (!folder) return false;

    this.databaseService.removeApprovedFolder(folderId);
    this.databaseService.logActivity({
      event_type: 'FOLDER_REMOVED',
      resource_type: 'FOLDER',
      resource_id: folderId,
      summary: `Folder removed from approved scope: ${folder.name} (${folder.path})`
    });
    this.refreshCache();
    return true;
  }

  public toggleFolder(folderId: string, enabled: boolean): boolean {
    const folder = this.databaseService.getApprovedFolderById(folderId);
    if (!folder) return false;

    this.databaseService.toggleFolder(folderId, enabled);
    this.refreshCache();
    return true;
  }

  public getApprovedFolders(): ApprovedFolderRecord[] {
    return this.databaseService.getApprovedFolders();
  }

  public getApprovedFolderById(folderId: string): ApprovedFolderRecord | null {
    return this.databaseService.getApprovedFolderById(folderId);
  }

  /**
   * Validates whether a file or subdirectory path falls strictly within user-approved folders.
   * Handles Windows case-insensitivity, path traversal ('..'), and junction/symlink escapes.
   */
  public isPathWithinApprovedFolder(targetRawPath: string): PathValidationResult {
    const canonicalTarget = this.canonicalize(targetRawPath);

    if (!canonicalTarget) {
      return { isValid: false, canonicalPath: '', error: 'INVALID_PATH' };
    }

    const lowerTarget = canonicalTarget.toLowerCase();

    for (const approved of this.cachedApprovedFolders.values()) {
      if (!approved.enabled) continue;

      const canonicalApproved = this.canonicalize(approved.path);
      const lowerApproved = canonicalApproved.toLowerCase();

      // Case-insensitive exact match or subpath prefix check
      if (
        lowerTarget === lowerApproved ||
        lowerTarget.startsWith(lowerApproved + path.sep)
      ) {
        // Reparse Point / Junction / Symlink safety check:
        // Ensure resolved realpath does not point outside the approved root!
        if (fs.existsSync(canonicalTarget)) {
          try {
            const realTarget = fs.realpathSync(canonicalTarget);
            const lowerReal = this.canonicalize(realTarget).toLowerCase();
            const lowerApprovedReal = fs.existsSync(canonicalApproved)
              ? this.canonicalize(fs.realpathSync(canonicalApproved)).toLowerCase()
              : lowerApproved;

            if (
              lowerReal !== lowerApprovedReal &&
              !lowerReal.startsWith(lowerApprovedReal + path.sep) &&
              lowerReal !== lowerApproved &&
              !lowerReal.startsWith(lowerApproved + path.sep)
            ) {
              return {
                isValid: false,
                canonicalPath: canonicalTarget,
                error: 'SECURITY_VIOLATION: Symlink or junction points outside approved folder scope.'
              };
            }
          } catch {
            return {
              isValid: false,
              canonicalPath: canonicalTarget,
              error: 'SECURITY_VIOLATION: Cannot safely resolve canonical realpath.'
            };
          }
        }

        return {
          isValid: true,
          canonicalPath: canonicalTarget,
          matchedFolder: approved
        };
      }
    }

    return {
      isValid: false,
      canonicalPath: canonicalTarget,
      error: 'PERMISSION_DENIED: Path is outside approved user folders.'
    };
  }
}
