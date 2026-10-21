# Radial File Studio (radialtool)

> **Status:** Draft v0.3 — Stabilization & Persistent Indexing Complete  
> **Platform:** Windows 10 / Windows 11 (x64)  
> **Repository:** [https://github.com/vincentjiu23/widget-convert-file-management](https://github.com/vincentjiu23/widget-convert-file-management)

Radial File Studio is a Windows desktop application centered on a **floating glass widget**. When a user drags a file from Windows File Explorer over the primary circle, the app detects the file category (image, video, or document) and dynamically expands a context-sensitive conversion ring with compatible output formats only.

---

## 🎨 Visual Design Inspiration

Based on confirmed design references:
1. **Glassmorphism UI:** Light theme, translucent white panels with large radii (24px–28px), subtle background blur (`backdrop-filter: blur(28px)`), soft atmospheric drop shadows, crisp hairline borders (`1px solid rgba(255, 255, 255, 0.85)`).
2. **Dynamic Radial Menu:** Circular primary center disk with concentric outer format sectors, thin dividing gaps (3° angular gap), peach → coral → violet gradient accents (`#ff7e5f` to `#feb47b`), and real-time pointer highlight glow.

---

## 🚀 Key Features & Architectural Hardening

- **External Windows Explorer Drag & Drop with Empty-MIME Fallback (P0):**
  - Resolves standard Chromium limitation where external Explorer dragover hides file metadata before drop.
  - Automatically activates **Universal Quick-Conversion Ring** (`PNG`, `JPEG`, `MP4`, `PDF`, `DOCX`, `TXT`) if MIME is empty during drag.
  - On `drop`, exact Windows path is extracted via `webUtils.getPathForFile(file)` and validated with cross-category safety guards.
- **Authoritative IPC Security & Directory Scope Enforcement (P0):**
  - Main Process serves as the single source of truth (`FolderPermissionRegistry.ts`).
  - Strict canonicalization (`path.resolve`), drive root scanning prevention (`C:\` blocked), Windows system path protection (`C:\Windows`, `C:\Program Files` blocked), and path traversal (`..` escapes) rejection.
  - Watchers and file operations outside approved user folders are denied with `PERMISSION_DENIED`.
- **Persistent Local SQLite Index (`DatabaseService.ts` & `FileIndexer.ts`) (P1):**
  - Official SQLite engine (`sql.js` WASM) with zero native compilation dependencies.
  - Auto-applied database schema migrations (`selected_folders`, `file_index_entries`, `conversion_jobs`, `activity_events`, `app_settings`).
  - Initial recursive scanning (depth-limited, symlink escape protection, metadata only).
  - Incremental event indexing via native Windows `ReadDirectoryChangesW` watcher with debouncing.
  - Periodic reconciliation sweeps after sleep/resume or buffer overflow.
- **Dashboard Data Integration:**
  - Real approved folders management, live scan progress notifications, full file search (`name LIKE ?`), conversion queue tracking, and activity audit log.
- **Keyboard Navigation & Accessibility:**
  - ArrowLeft/ArrowRight to cycle through sectors, Enter to confirm, Escape to cancel back to idle.

---

## 📁 Repository Structure

```
radialtool/
├── docs/
│   ├── PRD.md                   # Full Radial File Studio PRD v0.3 Draft
│   ├── TECH_SPIKE_REPORT.md     # Technical Spike: Electron vs Tauri 2 evaluation
│   ├── DECISION_LOG.md          # Architectural Decision Records (ADRs 001 - 008)
│   ├── OPEN_QUESTIONS.md        # Unresolved product decisions
│   ├── architecture.md          # System diagram & state machine
│   ├── converters.md            # Conversion capability matrix & licenses
│   └── security.md              # Privacy & boundary guarantees
├── src/
│   ├── main/                    # Electron main process (authoritative core)
│   │   ├── index.ts             # App lifecycle & single instance lock
│   │   ├── window.ts            # Transparent frameless always-on-top window
│   │   ├── watcher.ts           # ReadDirectoryChangesW native wrapper
│   │   ├── ipc.ts               # Secured typed IPC handlers
│   │   ├── database/
│   │   │   └── DatabaseService.ts # SQLite storage, migrations, CRUD
│   │   ├── security/
│   │   │   └── FolderPermissionRegistry.ts # Path containment & traversal defense
│   │   └── indexer/
│   │       └── FileIndexer.ts   # Initial scan, incremental sync, reconciliation
│   ├── preload/                 # Preload context bridge (webUtils path extraction)
│   │   └── index.ts
│   ├── renderer/                # React 18 + Vite UI
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── RadialWidget.tsx
│   │   │   │   └── DashboardModal.tsx
│   │   │   ├── core/
│   │   │   │   ├── RadialGeometry.ts
│   │   │   │   ├── FileClassifier.ts
│   │   │   │   ├── CapabilityRegistry.ts
│   │   │   │   └── RadialStateMachine.ts
│   │   │   ├── styles/
│   │   │   │   └── glassmorphism.css
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   └── index.html
│   └── shared/
│       └── types.ts             # Shared TypeScript models
├── tests/                       # Automated Vitest test suites (41 tests)
│   ├── RadialGeometry.test.ts
│   ├── FileClassifier.test.ts
│   ├── FileClassifierEmptyMime.test.ts
│   ├── CapabilityRegistry.test.ts
│   ├── RadialStateMachine.test.ts
│   ├── SecurityAndPermissions.test.ts
│   └── DatabaseAndIndexer.test.ts
├── .gitignore
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🛠️ Setup & Running Instructions

### Prerequisites
- Windows 10 or Windows 11 (x64)
- Node.js >= 20 (Node.js v22.18.0 tested)
- npm >= 10 (npm 10.9.3 tested)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Test Suites
```bash
npm test
```
Runs **41 unit & integration tests** across 7 test files covering geometry, classification, empty MIME fallback, security boundaries, and SQLite indexing.

### 3. Build Production Bundle
```bash
npm run build
```
Type checks (`tsc`) and builds production distribution bundles for Vite, Electron main process, and preload script into `dist/` and `dist-electron/`.

### 4. Launch Development Desktop App
```bash
npm run dev
```

---

## 🧪 Windows Manual Verification Checklist

- [x] **Transparent Always-On-Top Window:** Window launches centered on screen with crystal clear transparency and no gray borders.
- [x] **Explorer Drag with Empty MIME:** Dragging files from Windows Explorer (where MIME is hidden before drop) activates the universal format ring smoothly.
- [x] **Pointer Sector Tracking:** Hovering over sectors illuminates format cards with peach/coral glow.
- [x] **Drop Confirmation & Intent:** Releasing file on a target sector validates compatibility and registers the conversion job.
- [x] **Safe Drop Outside:** Releasing file outside the ring resets widget to idle without creating jobs.
- [x] **Escape Key Cancellation:** Pressing `Escape` at any time immediately dismisses the radial menu.
- [x] **IPC Path Traversal Protection:** Direct attempts to invoke filesystem actions on `C:\Windows` or `..` paths are strictly rejected with `PERMISSION_DENIED`.
- [x] **SQLite Database Durability:** Monitored folders, scanned metadata, and activity logs survive application restarts in `radial_studio.sqlite`.
- [x] **Native Filesystem Watcher:** Modifying or deleting files inside approved folders updates the SQLite index incrementally.