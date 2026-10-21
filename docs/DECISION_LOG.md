# Decision Log (ADR) --- Radial File Studio

This document records architectural and product decisions made during the development of Radial File Studio.

---

## ADR-001: Desktop Framework Selection (Electron vs Tauri 2)
- **Status:** Decided (Phase 0 Spike)
- **Date:** 2026-10-22
- **Context:** The application requires a floating, frameless, transparent glassmorphism widget that tracks real-time pointer coordinates (`dragover`) while a user is dragging files from Windows File Explorer, allowing interactive hover preview of radial sectors before dropping.
- **Options Considered:**
  1. *Tauri 2 (Rust + WebView2 + TypeScript)*: Lower idle RAM (~35MB), smaller binary, but lacks continuous DOM pointer coordinates during external OLE drag from Windows Explorer in WebView2 without low-level Win32 hooks. Requires Rustup + MSVC C++ Build Tools (not present on developer host).
  2. *Electron (Node.js + Chromium + TypeScript)*: Emits standard continuous `dragover` events with `clientX/clientY` during external Explorer drag, enabling seamless real-time radial sector hit-testing. Direct file path extraction via `webUtils.getPathForFile`. Mature Win32 transparency and mouse click-through (`setIgnoreMouseEvents`). Ready on developer host (Node 22.18.0 installed).
- **Decision:** Select **Electron + Vite + TypeScript**.
- **Consequences:** Slightly higher memory footprint (~65MB idle), but eliminates technical blockers for external drag-hover sector tracking and accelerates MVP delivery.

---

## ADR-002: Radial Sector Scope (Output Formats Only)
- **Status:** Decided (Owner Decision v0.2 → v0.3)
- **Date:** 2026-10-22
- **Context:** Should the outer radial ring mix action tasks (resize, compress, rotate, extract) with target formats?
- **Decision:** The outer conversion ring will display **output formats only**, tailored dynamically to the detected file category (e.g. PNG, JPEG, WebP for Images; MP4, WebM for Videos; PDF, DOCX, TXT for Documents).
- **Consequences:** Clean, unambiguous interaction. Compression or options are exposed either through presets or dashboard settings, not mixed into the outer format ring.

---

## ADR-003: Onboarding & Folder Access Policy
- **Status:** Decided (Owner Decision)
- **Date:** 2026-10-22
- **Context:** Should the app automatically scan all user libraries or hard drives on first launch?
- **Decision:** No silent scanning. Onboarding displays individually selectable checkboxes for Desktop, Documents, Downloads, Pictures, and Videos, plus a custom folder picker. Only explicitly approved folders are indexed and monitored.
- **Consequences:** Preserves user privacy, avoids disk thrashing, and builds user trust.

---

## ADR-004: Filesystem Monitoring Architecture
- **Status:** Decided (Owner Decision & Spike)
- **Date:** 2026-10-22
- **Context:** Should filesystem scanning rely on a standalone Python background daemon?
- **Decision:** No separate Python daemon. File system monitoring uses native Windows notifications (`ReadDirectoryChangesW`) managed directly within the desktop backend process, backed by a periodic reconciliation scan and local SQLite storage.
- **Consequences:** Zero external runtime dependencies; lightweight, reliable native Windows events.

---

## ADR-005: File Safety & Output Collision Policy
- **Status:** Decided (Owner Decision)
- **Date:** 2026-10-22
- **Context:** Handling existing files with identical names in the destination directory.
- **Decision:** Never overwrite source files or existing output silently. The default policy creates a uniquely suffixed filename (e.g., `document (1).pdf`) and validates output existence and file size before marking a job as `SUCCEEDED`.
- **Consequences:** Eliminates accidental data loss.

---

## ADR-006: External Explorer Drag with Empty MIME Fallback
- **Status:** Decided (Stabilization Spike)
- **Date:** 2026-10-22
- **Context:** During external dragover from Windows File Explorer, Chromium does not disclose file contents or reliable MIME types (`item.type === ''`) to protect local system security until the file is dropped.
- **Decision:** When an external file drag is detected (`Files` data transfer type) but MIME/extension is empty, the widget reveals a **Universal Quick-Conversion Ring** containing the primary targets (`PNG`, `JPEG`, `MP4`, `PDF`, `DOCX`, `TXT`). When the user drops the file onto a sector, the exact file path and extension are resolved via `webUtils.getPathForFile` and validated against cross-category rules before job queueing.
- **Consequences:** The radial ring reliably appears during Windows Explorer drag without failing or freezing, and drops are strictly validated against incompatible target formats.

---

## ADR-007: Authoritative IPC Security & Directory Scope Enforcement
- **Status:** Decided (Stabilization Spike)
- **Date:** 2026-10-22
- **Context:** The frontend renderer cannot be trusted as the sole validator for filesystem operations, watchers, or path access.
- **Decision:** The Electron Main Process serves as the strict single source of truth (`FolderPermissionRegistry`). All paths are canonicalized (`path.resolve`), Windows drive roots (`C:\`) and protected system paths (`C:\Windows`, `C:\Program Files`) are forbidden, and path traversal (`..` escapes) are blocked. Any watcher or file operation outside approved folders returns `PERMISSION_DENIED`.
- **Consequences:** Hardens local desktop security and prevents malicious renderer exploits.

---

## ADR-008: Persistent Local Indexing via SQLite (sql.js WASM)
- **Status:** Decided (Stabilization Spike)
- **Date:** 2026-10-22
- **Context:** The application requires persistent local metadata indexing, schema migrations, and fast search without requiring MSVC C++ compilation tools on the host.
- **Decision:** Use official SQLite WebAssembly (`sql.js`) with disk persistence (`radial_studio.sqlite`). Provides schema migrations (`schema_migrations`), indexed querying, initial scans, incremental event indexing, and periodic reconciliation sweeps.
- **Consequences:** Full SQL querying and durability without native binary compilation dependencies.
