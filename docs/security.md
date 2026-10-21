# Security, Privacy & Boundary Guarantees

Radial File Studio is designed from day zero as a **local-first, privacy-respecting** utility.

---

## 1. Zero Cloud Transmission
- **No telemetry by default:** The application does not send crash logs, usage metrics, or file contents to remote endpoints.
- **Local conversion:** All format transformations occur in local child processes or in-memory pipelines.

---

## 2. Process Safety & Command Execution
- **Strictly No Shell Concatenation:** Converter tools (e.g. FFmpeg) are executed via `child_process.spawn(executablePath, argsArray, { shell: false })`. File paths are never passed into a shell string (e.g. `cmd /c` or bash), eliminating command injection vulnerabilities.
- **Path Sanitization:** All incoming paths are normalized via `path.resolve()` and checked against null byte injections.
- **Resource Throttling:** Child conversion processes run with execution timeouts (e.g. 10 minutes max for video) and bounded concurrency (max 2 parallel conversions by default).

---

## 3. Filesystem Scope Enforcement
- **Permission Boundary:** The application only scans directories explicitly approved in `FolderPermissionRegistry`.
- **No Symlink Escapes:** Filesystem monitoring detects and refuses to follow symlinks/reparse points pointing outside approved folder roots.
- **Recycle Bin Deletion:** Any user-initiated file deletion defaults to the Windows Recycle Bin rather than permanent unrecoverable deletion.
- **Non-Destructive Outputs:** Existing files are never overwritten silently. When collisions occur, an incremental suffix is applied (`file (1).ext`).
