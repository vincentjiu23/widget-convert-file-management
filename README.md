# Radial File Studio (radialtool)

> **Status:** Draft v0.3 — Phase 0 Complete (Proof of Concept & Technical Spike)  
> **Platform:** Windows 10 / Windows 11  
> **Repository:** [https://github.com/vincentjiu23/widget-convert-file-management](https://github.com/vincentjiu23/widget-convert-file-management)

Radial File Studio is a Windows desktop application centered on a **floating glass widget**. When a user drags a file from Windows File Explorer over the primary circle, the app detects the file category (image, video, or document) and dynamically expands a context-sensitive conversion ring with compatible output formats only.

---

## 🎨 Visual Design Inspiration

Based on confirmed design references:
1. **Glassmorphism UI:** Light theme, translucent white panels with large radii (24px–28px), subtle background blur (`backdrop-filter: blur(28px)`), soft atmospheric drop shadows, crisp hairline borders (`1px solid rgba(255, 255, 255, 0.85)`).
2. **Dynamic Radial Menu:** Circular primary center disk with concentric outer format sectors, thin dividing gaps (3° angular gap), peach → coral → violet gradient accents (`#ff7e5f` to `#feb47b`), and real-time pointer highlight glow.

---

## 🚀 Key Features Built in Phase 0 (PoC)

- **Floating Glassmorphic Radial Widget:** Precision trigonometric sector hit-testing (`RadialGeometry.ts`) converting $(x, y)$ client coordinates into polar angles $[0^\circ, 360^\circ)$ clockwise from North (12 o'clock).
- **External Windows Explorer Drag & Drop:** Real-time continuous coordinate tracking via `dragover` to preview outer format sectors before dropping. Direct authoritative file path extraction via `webUtils.getPathForFile(file)`.
- **File Classifier (`FileClassifier.ts`):** Detects file categories:
  - **Images:** PNG, JPEG, JPG, WEBP, BMP, GIF, SVG.
  - **Videos:** MP4, WEBM, MOV, MKV, AVI.
  - **Documents:** PDF, DOCX, TXT, XLSX, PPTX.
  - **Unsupported/Unknown:** Explains why without silent failure.
- **Capability Registry (`CapabilityRegistry.ts`):** Dynamic output formats:
  - *Image:* PNG, JPEG, WEBP, BMP
  - *Video:* MP4, WEBM
  - *Document:* PDF, DOCX, TXT
  - Handles same-format edge cases safely.
- **Deterministic State Machine (`RadialStateMachine.ts`):**
  `IDLE` ➔ `FILE_HOVER` ➔ `TYPE_DETECTED` ➔ `FORMAT_RING_VISIBLE` ➔ `SECTOR_HOVER` ➔ `DROP_VALIDATION` ➔ `JOB_QUEUED` ➔ `PROCESSING` ➔ `SUCCESS` / `ERROR`.
  *Safety Guarantee:* Hover alone never executes a conversion.
- **Native Windows Directory Watcher (`DirectoryWatcherService.ts`):** Uses Windows native `ReadDirectoryChangesW` I/O completion ports via Node.js `fs.watch({ recursive: true })` with debouncing.
- **Onboarding & Folder Permission Registry:** Selectable Desktop, Documents, Downloads, Pictures, and Videos checkboxes + custom folder picker. Only approved directories are indexed.
- **Keyboard Navigation & Accessibility:** ArrowLeft/ArrowRight to cycle through sectors, Enter to confirm, Escape to cancel back to idle.

---

## 📁 Repository Structure

```
radialtool/
├── docs/
│   ├── PRD.md                   # Full Radial File Studio PRD v0.3 Draft
│   ├── TECH_SPIKE_REPORT.md     # Technical Spike: Electron vs Tauri 2 evaluation
│   ├── DECISION_LOG.md          # Architectural Decision Records (ADRs)
│   ├── OPEN_QUESTIONS.md        # Unresolved product decisions
│   ├── architecture.md          # System diagram & state machine
│   ├── converters.md            # Conversion capability matrix & licenses
│   └── security.md              # Privacy & boundary guarantees
├── src/
│   ├── main/                    # Electron main process (Window, IPC, Watcher)
│   │   ├── index.ts
│   │   ├── window.ts
│   │   ├── watcher.ts
│   │   └── ipc.ts
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
│       └── types.ts             # Shared TypeScript interfaces
├── tests/                       # Vitest automated test suite
│   ├── RadialGeometry.test.ts
│   ├── FileClassifier.test.ts
│   ├── CapabilityRegistry.test.ts
│   └── RadialStateMachine.test.ts
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

### 2. Run Automated Unit Tests
```bash
npm test
```
Runs 18 unit tests covering trigonometry calculations, sector hit-testing, MIME detection, capability rules, and state machine transitions.

### 3. Launch Development Desktop App
```bash
npm run dev
```

---

## 🧪 Windows Manual Test Verification Checklist

- [x] **Transparent Always-On-Top Window:** Window launches centered on screen without borders or gray background artifacts.
- [x] **External Explorer Drag-over:** Dragging a file from Windows Explorer into the central circle triggers file classification and reveals the outer format ring.
- [x] **Real-Time Sector Tracking:** Hovering mouse across outer sectors highlights target format in peach/coral glow and displays real-time target preview in the center circle.
- [x] **Drop Confirmation:** Releasing file on a target format sector confirms conversion and creates an asynchronous job.
- [x] **Safe Outside Drop:** Releasing file outside the ring cancels safely without creating a job.
- [x] **Escape Key Cancellation:** Pressing `Escape` at any time immediately dismisses the radial menu.
- [x] **Unsupported Files:** Dragging an `.exe` or `.zip` displays an explanatory badge and disables the conversion ring.
- [x] **Dashboard Onboarding:** Users can toggle individual common folders (Desktop, Documents, etc.) or add a custom folder via native Windows picker.
- [x] **Native Filesystem Watcher:** Modifying files in approved folders emits live kernel file events to the dashboard.