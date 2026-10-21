# Radial File Studio

<div align="center">
  <img src="build/icon.png" alt="Radial File Studio Icon" width="128" height="128"/>
  <h3>Windows-First Floating Glassmorphic Radial Desktop Converter & Local File Manager</h3>
  <p>Fast, elegant, and secure drag-and-drop file conversions with persistent indexing for Windows 10 & 11.</p>
</div>

---

## 📥 Download & Installation

The official distribution channel is **[GitHub Releases](https://github.com/vincentjiu23/widget-convert-file-management/releases)**.

| Package Type | File Name | Description |
| :--- | :--- | :--- |
| **Windows Installer (Recommended)** | `Radial File Studio-Setup-0.3.0.exe` | Standard NSIS installer that creates Desktop & Start Menu shortcuts, manages installed files, and provides clean Windows uninstallation. |
| **Portable Version** | `Radial File Studio-Portable-0.3.0.exe` | Standalone single-executable. Run directly from any folder or USB drive with zero installation required. |
| **Integrity Checksums** | `SHA256SUMS.txt` | Cryptographic SHA-256 hashes to verify package authenticity before running. |

### 🚀 Installation Steps

1. **Download:** Grab the latest `Radial File Studio-Setup-0.3.0.exe` (or Portable) from [GitHub Releases](https://github.com/vincentjiu23/widget-convert-file-management/releases).
2. **Run Installer:** Double-click the downloaded `.exe` file.
3. **SmartScreen Prompt:** Because this is an open-source binary built directly via GitHub Actions without a paid commercial EV certificate, Windows SmartScreen may show a prompt:
   - Click **More info**.
   - Click **Run anyway**.
4. **Complete Setup:** Choose your installation directory (defaults to `%LOCALAPPDATA%\Programs\radial-file-studio`) and finish setup. The app launches automatically.

### 🗑️ Uninstallation
- Open **Windows Settings** → **Apps** → **Installed Apps** (or **Control Panel** → **Programs and Features**).
- Select **Radial File Studio** and click **Uninstall**.
- The uninstaller cleanly removes all application binaries and shortcuts without modifying your personal converted documents or source files.

---

## 💻 System Requirements

- **Operating System:** Windows 10 (64-bit, version 1809 or higher) or Windows 11 (64-bit).
- **Architecture:** x86_64 (x64).
- **RAM:** 2 GB minimum (4 GB recommended for 40MP image processing).
- **Disk Space:** ~250 MB free disk space for application and local SQLite index.

---

## ✨ Features Available in v0.3.0

### 1. Floating Glassmorphic Radial Widget
- **Always-on-Top Floating Disk:** Sits elegantly on your desktop with smooth backdrop blur (`backdrop-filter: blur(28px)`) and responsive hover feedback.
- **External Explorer Drag-and-Drop:** Seamlessly drag files from Windows File Explorer over the center orb. Even when Windows hides file metadata during drag, the universal radial ring expands dynamically.
- **Radial Target Selection:** Move your pointer to hover over the desired format sector. Visual highlights confirm your conversion intent before dropping.
- **Keyboard Navigation:** Cycle sectors using `ArrowLeft` / `ArrowRight`, confirm with `Enter`, or dismiss with `Escape`.

### 2. High-Performance Local Image Conversion Engine
- **True Raster-to-Raster Processing:** Powered locally by native `sharp` (v0.35) and `libvips` C++ libraries bundled directly inside the app. No cloud uploads, no telemetry, 100% offline privacy.
- **Supported Image Formats:**
  - **PNG:** Lossless compression, full transparency support.
  - **JPEG / JPG:** Fast mozjpeg compression, customizable quality (1–100), automatic white background flattening for alpha channels.
  - **WebP:** Modern web format with high compression efficiency.
  - **BMP:** Full 32-bit/24-bit bitmap decode/encode via `bmp-js`.
  - **TIFF:** Archival-grade LZW-compressed multi-channel image output.
- **Metadata Inspection:** Automatic detection of dimensions, color channels, orientation, and format via binary magic bytes (never trusting file extensions).

### 3. Conversion Security Hardening & Zero-Trust Architecture
- **Atomic Hard-Link Publication:** Final output files are finalized using kernel-level hard link (`fs.promises.link`) publication directly into the destination directory. Destination files are never exposed in a truncated or partially-written state.
- **Strict Anti-Overwrite Protection:** The converter will **never overwrite** your source files or pre-existing files. When name collisions occur, the destination automatically generates deterministic sequential names (e.g. `photo (1).webp`, `photo (2).webp`).
- **Approved Folder Scope Enforcement:** The Main process strictly validates all input and output directories against the `FolderPermissionRegistry`. Path traversal (`..`), null-byte injection (`\0`), and protected system paths (`C:\Windows`, `C:\Program Files`, root drives `C:\`) are firmly blocked.
- **DoS & Image Decompression Bomb Defense:**
  - Max Source File Size: **50 MB**
  - Max BMP In-Memory Buffer: **30 MB**
  - Max Dimensions: **16,384 px** (width or height)
  - Max Pixels: **40,000,000 pixels** (40 Megapixels)
- **Concurrency Limiter:** Conversions are throttled to a maximum of **2 simultaneous jobs**, queuing additional requests to protect system memory and CPU responsiveness.
- **Clean Failure Guarantees:** Temporary files (`.tmp-*`) are guaranteed to be cleaned up upon failure or cancellation. Neighboring files are never touched.

### 4. Persistent SQLite File Indexer & Activity Audit Log
- **Embedded Database:** Powered by `sql.js` (SQLite WASM) stored locally at `%APPDATA%\radial-file-studio\radial_studio.sqlite`.
- **Directory Monitoring:** Uses Windows native `ReadDirectoryChangesW` watcher with debounced change detection.
- **Reconciliation & Purge:** Periodically sweeps indexed folders to sync offline additions and purge records for deleted files without losing unverified files.

---

## 📂 Storage Locations

| Data Type | Windows Path | Description |
| :--- | :--- | :--- |
| **Application Data** | `%APPDATA%\radial-file-studio\` | Contains `radial_studio.sqlite` (approved folder list, file index, conversion history, and activity logs). |
| **Installed Binaries** | `%LOCALAPPDATA%\Programs\radial-file-studio\` | Packaged Electron binaries, resources, and dependencies. |
| **Conversion Outputs** | Same folder as source file (or user-chosen approved folder) | Created cleanly with anti-overwrite protection. |

---

## 🛠️ Developer & Build Guide

### Prerequisites
- Node.js >= 20 (Node.js v22 tested)
- npm >= 10
- Windows 10/11 x64 development machine

### Setup & Commands
```bash
# Clone the repository
git clone https://github.com/vincentjiu23/widget-convert-file-management.git
cd widget-convert-file-management

# Install dependencies strictly from lockfile
npm ci

# Run Vitest automated test suite (133 tests)
npm test

# Build production TypeScript & Vite bundles
npm run build

# Package Windows NSIS Installer (.exe) and Portable version (.exe)
npm run package:all
```

Package outputs will be placed in the `release/` directory:
- `release/Radial File Studio-Setup-0.3.0.exe`
- `release/Radial File Studio-Portable-0.3.0.exe`

---

## 📦 GitHub Releases vs. GitHub Packages

- **GitHub Releases (Primary Channel):** Used for end-user Windows desktop distribution. Users download the `.exe` installers directly without needing git, Node.js, or development tools.
- **GitHub Packages:** Radial File Studio is a standalone desktop application rather than a reusable npm library or container image. Therefore, binary distribution is routed through GitHub Releases for maximum accessibility.

---

## 🔒 Code Signing & Windows SmartScreen Information

Radial File Studio is distributed as free, open-source software built transparently via GitHub Actions.

At this time, releases are **unsigned** (no commercial Microsoft Authenticode Extended Validation certificate is attached). Because of this:
1. Windows Defender SmartScreen will display an informational warning (*"Unknown Publisher"*).
2. This warning is expected for newly published open-source executables until sufficient global reputation is established.
3. Every release publishes verifiable `SHA256SUMS.txt` cryptographic checksums generated directly by the GitHub Actions runner, allowing users to verify binary integrity.

---

## 🐛 Troubleshooting & Known Limitations

1. **SmartScreen blocks execution:** Click *More info* → *Run anyway*.
2. **File conversion fails with `FILE_TOO_LARGE`:** The file exceeds the 50MB safety limit or 40 Megapixel decompression threshold.
3. **Conversion rejected with `SECURITY_VIOLATION`:** The output destination or source directory is located outside approved folders or in a protected system directory (`C:\Windows`, `C:\Program Files`). Add the folder to the approved list in the Dashboard.
4. **Video & Audio conversions:** The current version (v0.3.0) implements the complete, hardened **Image Conversion MVP**. Video and document conversion engines are scheduled for subsequent milestone releases (see `docs/PRD.md`).

---

## 📄 License
MIT License. Copyright © 2026 Vincent.