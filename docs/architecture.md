# System Architecture --- Radial File Studio

Radial File Studio is structured into clean, decoupled layers separating presentation, desktop integration, domain logic, filesystem watching, and conversion engines.

```
Desktop Shell (Electron Main Process)
├── WindowManager (FloatingWidgetWindow, DashboardWindow)
├── TrayManager (Windows Notification Area)
├── DragDropBridge (Native OLE coordinate & path bridge)
├── FilesystemWatcher (ReadDirectoryChangesW via Node.js)
├── LocalDatabase (SQLite / Metadata Index & Job Store)
└── ConversionOrchestrator (Child process worker pool)

Preload Layer (Context Bridge)
└── window.radialAPI (Strictly typed, sanitized IPC bridge)

Renderer Layer (React + Vite + TypeScript)
├── RadialWidget (Floating glass circle & outer format ring)
│   ├── RadialGeometry (Trigonometric sector hit-testing)
│   ├── FileClassifier (MIME & extension categorizer)
│   ├── CapabilityRegistry (Supported input-to-output matrix)
│   └── RadialStateMachine (Comprehensive UX interaction transitions)
└── DashboardView (Folder management, indexing, queue, settings)
    ├── FolderPermissionRegistry
    ├── DirectoryBrowser
    ├── SearchEngine
    └── ActivityLog
```

---

## 1. Radial Interaction State Machine

```
   ┌──────────────┐
   │    HIDDEN    │
   └──────┬───────┘
          │ (Show widget hotkey / startup)
          ▼
   ┌──────────────┐
   │IDLE_COLLAPSED│◄────────────────────────────────────────────────┐
   └──────┬───────┘                                                 │
          │ (External file dragged into window)                     │
          ▼                                                         │
   ┌──────────────┐                                                 │
   │  FILE_HOVER  │                                                 │
   └──────┬───────┘                                                 │
          │ (Analyze file extension/MIME)                           │
          ▼                                                         │
   ┌──────────────┐ (Unsupported) ┌─────────────────────────┐       │
   │TYPE_DETECTED ├──────────────►│    UNSUPPORTED_TYPE     ├───────┤ (Dismiss / Drag leave)
   └──────┬───────┘               └─────────────────────────┘       │
          │ (Supported Category: Image / Video / Doc)               │
          ▼                                                         │
   ┌────────────────────┐                                           │
   │FORMAT_RING_VISIBLE │                                           │
   └──────┬─────────────┘                                           │
          │ (Pointer moves into outer ring annulus)                 │
          ▼                                                         │
   ┌──────────────┐                                                 │
   │SECTOR_HOVER  │ (Calculate angle & highlight target sector)     │
   └──────┬───────┘                                                 │
          ├─── (Drag moved outside / Escape) ───────────────────────┤
          │                                                         │
          │ (Drop event released on valid sector)                   │
          ▼                                                         │
   ┌──────────────┐                                                 │
   │DROP_VALIDATE │                                                 │
   └──────┬───────┘                                                 │
          │ (Validation OK)                                         │
          ▼                                                         │
   ┌──────────────┐                                                 │
   │ JOB_QUEUED   │                                                 │
   └──────┬───────┘                                                 │
          │                                                         │
          ▼                                                         │
   ┌──────────────┐                                                 │
   │  CONVERTING  │                                                 │
   └──────┬───────┘                                                 │
          ├─── (Output validated) ──► [SUCCESS STATE] ──────────────┘
          └─── (Error / Abort)    ──► [ERROR STATE]   ──────────────┘
```

---

## 2. Hit-Testing Trigonometry

Given:
- Center of widget: $(c_x, c_y)$
- Inner radius: $r_{in}$ (e.g. 64px)
- Outer radius: $r_{out}$ (e.g. 140px)
- Pointer position: $(p_x, p_y)$

1. **Euclidean distance:**
   $$d = \sqrt{(p_x - c_x)^2 + (p_y - c_y)^2}$$

2. **Angle calculation in degrees clockwise starting at North (0°):**
   $$\theta = \left(\text{atan2}(p_y - c_y, p_x - c_x) \times \frac{180}{\pi} + 90\right) \pmod{360}$$
   If $\theta < 0$, $\theta += 360$.

3. **Sector Assignment:**
   For $N$ sectors, each sector covers $\text{span} = \frac{360^\circ}{N}$.
   $$\text{index} = \left\lfloor \frac{\theta}{\text{span}} \right\rfloor$$
   Sector is active if and only if $r_{in} \le d \le r_{out}$.
