# Radial File Studio --- PRD v0.3 (Draft for Review)

**Status:** Draft, not final; owner decisions incorporated, technical choices remain open.  
**Platform:** Windows desktop (Windows 10 / 11).  
**Direction:** Floating glass widget with a primary circle and a context-sensitive outer conversion ring, local image/video/document conversion, and a full dashboard that indexes selected Windows folders from first run.

---

## 1. Executive Summary

Radial File Studio is a Windows desktop application centered on a floating glass widget. When a user drags a file from Windows File Explorer over the primary circle, the app detects the file category (image, video, or document) and reveals a context-sensitive conversion ring around the main circle. Hovering previews a compatible conversion; dropping onto a valid target confirms the action and creates a local job.

A dashboard provides deeper file management, search, previews, safe file operations, conversion history, and monitoring. On first run, the app guides users to select common folders or other roots to index and monitor in the background.

The app is **local-first**. It must not silently scan all drives or upload files by default. Originals remain untouched by default, and conversion creates a new output file.

---

## 2. Confirmed Choices from the Owner

| Area | Current Direction |
|---|---|
| Platform | Windows first (10 / 11) |
| Radial UX | Custom radial menu with central circle and outer format ring |
| Conversion scope | Broad, phased across major categories (Images, Video, Documents first) |
| File management | Full / advanced dashboard |
| Directory access | Selected folders only (explicit user approval) |
| Processing | Local-first; no default cloud uploads |
| Widget | Floating, always-on-top glassmorphic widget |
| Safety | Preserve source by default; no silent overwrite; safe defaults |
| Visual | Modern glassmorphism (translucent white, subtle blur, peach–coral–violet accents) |

### Owner Decisions Incorporated (v0.2 review → v0.3 draft)
1. **Primary circle & outer ring:** The primary circle remains the central widget. When a file is hovered over it, the app detects whether it is an image, video, or document and reveals an outer ring containing **output formats only**. Task actions such as compress or resize are not part of the outer ring in the current design.
2. **Initial conversion priority:** Images, video, and documents. Audio, archives, developer formats, and specialist formats are out of initial scope unless later approved.
3. **First-run onboarding:** Must offer Desktop, Documents, Downloads, Pictures, and Videos as individually selectable common folders, plus a custom-folder picker. The user explicitly chooses which folders to index; do not silently index them all. Indexing and background monitoring begin only for approved folders.
4. **Filesystem monitoring architecture:** Do not run a separate always-on Python scanner by default. Prefer native Windows filesystem notifications (`ReadDirectoryChangesW`) plus a reconciliation scan, with a background application process and local SQLite index. Python may be used for a conversion adapter or a measured technical need, but is not the default filesystem-monitoring architecture.
5. **Batch conversion:** Included in the MVP when the selected local conversion engines support reliable batch operation. If a specific engine cannot safely support it, that format/adapter may be deferred rather than weakening validation or safety.
6. **iLovePDF as workflow reference:** iLovePDF is a workflow reference, not a backend dependency: clear source-to-target conversion choices, batch-friendly job flow, progress, and easy-to-find outputs. Radial File Studio must not upload files to iLovePDF or any online service by default.

---

## 3. Product Vision and Principles

- **Vision:** Make frequent conversion and file organization fast through a radial desktop interaction while retaining a dependable file-management dashboard.
- **Principles:**
  1. *Radial is the fast-action surface; dashboard is the deep-management surface.*
  2. *Hover previews; drop or explicit confirmation executes.*
  3. *Never silently overwrite or delete.*
  4. *Preserve source files by default.*
  5. *Only index user-selected folders.*
  6. *Local processing is the default; no default cloud upload.*
  7. *A conversion is successful only after output validation.*
  8. *The app must remain responsive during scanning and conversion.*
  9. *File operations must revalidate paths because files may change outside the app.*
  10. *Do not promise undo unless a reliable recovery implementation exists.*

---

## 4. Target Users

- Creative professionals converting image, audio, and video assets.
- Office users handling documents, PDFs, and archives.
- Power users organizing many files across chosen folders.
- General Windows users who want quick conversions without launching a large program.

---

## 5. Information Architecture

### Floating Widget
- Compact idle state (primary circular disk)
- File drop target
- Radial sectors (outer concentric ring)
- Context-sensitive format ring (Image, Video, Document)
- Current file summary & compatibility validation
- Unsupported-file explanation
- Progress / result / error state
- Dashboard shortcut & quick controls

### Dashboard
- Overview (Selected folders, indexed file count, storage summary, recent activity)
- Directory browser (Tree & file list, sorting, filtering)
- Search (Scoped to authorized folders)
- Conversion queue & history (Source, target, output, duration, status)
- Safe file operations (Open, Reveal in Explorer, Copy, Rename, Recycle Bin)
- Settings & diagnostics

---

## 6. Radial Interaction Model

### Proposed State Machine
```
HIDDEN → IDLE_COLLAPSED → DRAG_HOVER → TYPE_DETECTED → FORMAT_RING_VISIBLE → SECTOR_HOVER → DROP_VALIDATION → JOB_CREATED → CONVERTING → RESULT/ERROR
```

### Proposed Behavior
- **Idle widget:** Compact, unobtrusive primary circle floating on the desktop.
- **External drag enters widget bounds:** Detects file MIME / extension while hovering over the primary circle.
- **Outer ring reveals:** Shows output formats only, dynamically tailored to the detected file category.
- **Pointer/drag position:** Highlights hovered sector with angle calculation and visual glow.
- **Preview:** Hovering a sector previews the conversion and destination naming.
- **Drop on valid target:** Confirms conversion and creates an asynchronous job.
- **Drop outside target:** Safely cancels without creating any job.
- **Escape key:** Immediately cancels and returns to idle.
- **Multi-file drag:** Shows count badge, detects common format suitability, and gates batch jobs.

---

## 7. Security and Privacy Guidelines

1. **Local-first execution:** All file processing and indexing is done on the local machine.
2. **Path safety:** Never construct shell commands via string concatenation. Always use argument arrays (`spawn(cmd, [args])`).
3. **Safe overwrites:** If destination file exists, generate non-colliding name (e.g. `file (1).ext`) or prompt user. Never overwrite silently.
4. **Boundary protection:** Enforce that operations and search stay within authorized user folders. Disallow unauthorized traversal outside approved directories.
5. **No execution of user file contents:** Files are parsed as data, never executed.
