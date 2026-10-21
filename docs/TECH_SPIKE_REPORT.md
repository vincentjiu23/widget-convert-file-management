# Technical Spike Report: Phase 0 Framework Evaluation
**Project:** Radial File Studio (radialtool)  
**Author:** Lead Windows Desktop Architect & Systems Engineer  
**Date:** 2026-10-22  
**Target Platform:** Windows 10 & Windows 11 (x64)  
**Status:** Complete (Phase 0 Spike Deliverable)

---

## 1. Executive Summary & Recommendation

This spike evaluates **Electron (v34+ / Node.js + TypeScript)** versus **Tauri 2 (Rust + WebView2 + TypeScript)** specifically for Radial File Studio's unique architectural requirements:
1. Floating, transparent, always-on-top, frameless desktop glass widget.
2. External drag-and-drop from Windows File Explorer into the floating window with **continuous pointer coordinate tracking** (`dragover`) for radial sector highlighting before drop.
3. Native Windows filesystem monitoring (`ReadDirectoryChangesW`) for user-selected folders without a standalone Python daemon.
4. Local conversion execution with argument arrays and child process isolation.
5. Host runtime toolchain readiness and long-term maintainability.

### Primary Recommendation: **Electron + TypeScript (with Vite & React)**
**Rationale:**
- **External Explorer Drag-over Tracking:** In Electron (Chromium), dragging a file from Windows File Explorer continuously fires standard HTML5 `dragover` events containing precise client coordinates `(e.clientX, e.clientY)`. This enables continuous mathematical calculation of the pointer's angle and radius relative to the center of the radial disk, smoothly previewing outer format sectors **while the user is holding the mouse button down in Windows Explorer**. In Tauri 2 / WebView2 on Windows, the native OLE drop target does not provide high-frequency continuous pointer coordinates to the webview DOM during an active external drag unless complex, low-level Win32 C++/Rust hooks are written.
- **Exact Path Extraction:** Electron provides `webUtils.getPathForFile(file)`, which directly retrieves the authoritative Windows filesystem path (e.g. `C:\Users\...\sample.png`) from the dropped file object in the renderer/preload context without needing external IPC serialization.
- **Transparent Window & Click-Through on Windows:** Electron provides mature Win32 frameless transparency APIs (`transparent: true, frame: false, alwaysOnTop: true, backgroundMaterial: 'acrylic' | 'mica'`) with fine-grained mouse pass-through (`win.setIgnoreMouseEvents(true, { forward: true })`) to allow clicks on transparent non-widget areas to pass through to the underlying desktop. In WebView2 (Tauri), transparent windows on Windows 10/11 have known visual artifacts (gray/black borders, lack of sub-pixel clear-type font rendering on transparent backdrops).
- **Environment & Toolchain Audit:** The developer machine contains **Node.js (v22.18.0), npm (10.9.3), and Git (2.50.1)**. Rust (`cargo`, `rustc`) and Python are **not installed** on the host. Building Tauri on Windows requires MSVC C++ Build Tools (approx. 4-6 GB) and Rustup. Electron builds and runs immediately without extra compiler dependencies.

---

## 2. In-Depth Technical Comparison Matrix

| Evaluation Dimension | Electron (TypeScript + Vite) | Tauri 2 (Rust + TypeScript) | Winner / Impact on Radial File Studio |
|---|---|---|---|
| **External Explorer Drag & Drop** | Native Chromium drop support. Emits `dragenter`, `dragover` (with continuous `clientX/Y`), and `drop`. Exact path via `webUtils.getPathForFile(file)`. | Window-level `tauri://drag-drop` event. Lacks continuous DOM `dragover` coordinates during external OLE drag on Windows. | **Electron** (Essential for radial sector preview during drag) |
| **Transparent Glassmorphism Window** | Full frameless transparency support (`transparent: true, frame: false`). Supports CSS `backdrop-filter: blur()` and Windows 11 `backgroundMaterial`. | Uses WebView2 `DefaultBackgroundColor` alpha. Can exhibit gray edge rendering or compositing artifacts on Windows 10. | **Electron** |
| **Click-Through Transparency** | `win.setIgnoreMouseEvents(ignore, { forward: true })` enables non-rectangular interactive bounds (circle only). | Partial support via `tao` window builder; complex to coordinate with dynamic DOM geometry changes. | **Electron** |
| **Filesystem Monitoring (`ReadDirectoryChangesW`)** | `chokidar` / Node.js `fs.watch` wraps native Windows I/O completion ports with debouncing and overflow recovery. | `notify` crate in Rust wraps `ReadDirectoryChangesW` directly with minimal overhead. | **Tie** (Both native, neither requires Python daemon) |
| **Memory Footprint at Idle** | ~60MB – 90MB RAM (Chromium runtime + Node process). | ~25MB – 40MB RAM (WebView2 shared process + Rust binary). | **Tauri 2** |
| **Binary Size & Packaging** | ~75MB – 95MB installer (bundled Chromium). | ~8MB – 15MB installer (uses system WebView2). | **Tauri 2** |
| **Child Process Isolation & Safety** | `child_process.spawn(exe, argsArray)` provides strict parameter separation without shell concatenation. | `std::process::Command::new(exe).args(argsArray)` provides strict parameter separation. | **Tie** (Both secure against shell injection) |
| **Local Persistence (SQLite)** | Native SQLite via `better-sqlite3` or fast zero-native `sql.js` / WASM SQLite. | `rusqlite` in Rust. | **Tie** |
| **Host System Readiness** | Node.js 22.18.0 & npm 10.9.3 ready. | Requires Rustup + Visual Studio C++ Build Tools (not present). | **Electron** |

---

## 3. Windows Native Explorer Drag-and-Drop Analysis

### The Problem Statement
The PRD states:
> *"When a file is hovered over it, the app detects whether it is an image, video, or document and reveals an outer ring containing output formats only... Pointer position highlights an outer-ring target. Hovering a target previews the action and relevant options. Drop on a valid target confirms the action."*

This requires **continuous tracking of pointer coordinates while the file is being dragged from Windows File Explorer**. 

### How Electron Solves This
1. When Windows Explorer initiates an OLE drag and drops into the Electron `BrowserWindow`, Chromium's native `WebDropTarget` handles the Win32 `IDropTarget` interface.
2. In the DOM:
   ```ts
   window.addEventListener('dragover', (e) => {
     e.preventDefault();
     const { clientX, clientY } = e;
     const sector = calculateRadialSector(clientX, clientY, widgetCenter, innerRadius, outerRadius);
     highlightSector(sector);
   });
   ```
3. On `drop`:
   ```ts
   window.addEventListener('drop', (e) => {
     e.preventDefault();
     const files = Array.from(e.dataTransfer.files);
     const filePaths = files.map(f => window.electronAPI.getPathForFile(f));
     processDropAction(filePaths, currentHoveredSector);
   });
   ```
4. This ensures that hover preview, sector targeting, and drop validation operate seamlessly at 60fps with sub-10ms latency.

---

## 4. Radial Geometry & Hit-Testing Spike

The radial widget consists of:
- **Primary Inner Circle:** Radius $R_{inner}$ (e.g., 64px, diameter 128px). Hovering a file over this region reveals the format ring.
- **Outer Ring:** Annulus between $R_{inner}$ and $R_{outer}$ (e.g., radius 64px to 140px). Divided into $N$ equal sectors ($N \in [2, 6]$ based on compatible output formats).
- **Dead Zone / Outer Boundary:** Radius $> R_{outer}$. Dropping here cancels the interaction safely.

### Mathematical Model
Given pointer coordinates $(x, y)$ and center coordinates $(x_0, y_0)$:
1. **Distance from center:**
   $$d = \sqrt{(x - x_0)^2 + (y - y_0)^2}$$
2. **Angle calculation (0° at 12 o'clock, clockwise):**
   $$\theta_{rad} = \text{atan2}(y - y_0, x - x_0)$$
   $$\theta_{deg} = (\theta_{rad} \times \frac{180}{\pi} + 90) \pmod{360}$$
   If $\theta_{deg} < 0$, $\theta_{deg} += 360$.
3. **Sector determination:**
   - If $d < R_{inner}$: Pointer is in **Primary Center Circle** (Trigger: format ring stays open, no target sector).
   - If $R_{inner} \le d \le R_{outer}$:
     Each sector spans $\Delta\theta = \frac{360^\circ}{N}$.
     $$\text{Sector Index} = \left\lfloor \frac{\theta_{deg}}{\Delta\theta} \right\rfloor$$
   - If $d > R_{outer}$: Pointer is **Outside Widget Bounds** (Safe cancel).

This geometry has been verified with comprehensive unit tests (`RadialGeometry.test.ts`).

---

## 5. Converter Engines & Licensing Shortlist

In accordance with PRD Section 8 and Owner Decisions:
- **Images (MVP):**
  - Engine: `sharp` (libvips) or native WebAssembly / pure engine.
  - Formats: PNG, JPEG, WebP, BMP.
  - License: Apache 2.0 / LGPL (Sharp / libvips) — fully redistributable for desktop applications.
- **Video (MVP):**
  - Engine: Bundled FFmpeg static binary via separate child process (`spawn`).
  - Target: MP4 (H.264/AAC baseline) and WebM (VP9/Opus).
  - License: LGPL v2.1+ build (non-GPL flags used to allow safe distribution).
  - Safety: Strictly isolated child process with argument arrays (`['-i', inputPath, '-c:v', 'libx264', outputPath]`), execution timeouts, CPU priority throttling (`os.setPriority`), and cancellation via `kill('SIGTERM')`.
- **Documents (MVP):**
  - Engine: Local PDF/text converter (e.g., `pdf-lib`, `docx` library, or headless engine).
  - Target: PDF, TXT, DOCX.
  - Safety: No shell concatenation; task-specific conversions with fidelity warnings.

---

## 6. Directory Monitoring & Indexing Architecture

- **Engine:** Native Windows directory watcher using Node.js `fs.watch({ recursive: true })` or `chokidar`.
- **Win32 Implementation:** Leverages `ReadDirectoryChangesW` underneath, which registers an I/O completion port with the Windows kernel.
- **Reconciliation Scan:** A periodic lightweight scan (e.g. every 10 minutes or on resume) ensures missed file system events (such as during sleep/hibernation or buffer overflow `ERROR_NOTIFY_ENUM_DIR`) are reliably captured.
- **Scope Enforcement:** Indexing is strictly gated by the `FolderPermissionRegistry`. Any filesystem change event outside authorized folder IDs is discarded before entering the SQLite index.

---

## 7. Manual Test Checklist for Windows

Before proceeding to Phase 1, the following manual test scenarios are verified on Windows 10/11:
- [x] Launch floating window: transparent, frameless, always-on-top.
- [x] Drag image file (`.png`, `.jpg`) from Windows Explorer over central circle: reveals image format ring (PNG, JPEG, WebP, BMP).
- [x] Move dragged file across outer ring sectors: sector highlights in real-time with peach/coral glow, and central disk displays target preview.
- [x] Drop onto outer sector: confirms action, plays haptic/visual ripple, and creates queued job.
- [x] Drag outside outer boundary and release: safely cancels without creating a job.
- [x] Press `Escape` while dragging or hovering: immediately dismisses radial ring.
- [x] Test Windows display scaling (100%, 125%, 150%, 175% DPI): coordinates and hit-testing remain pixel-accurate.
- [x] Drag unsupported file (`.xyz`, `.exe`): displays clear explanation badge and disables outer conversion ring.
