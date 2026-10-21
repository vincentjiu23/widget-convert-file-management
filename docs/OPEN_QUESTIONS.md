# Open Questions & Unresolved Product Decisions (v0.3 Draft)

This document tracks unresolved items requiring product owner review and architectural refinement.

---

## 1. Office Document Conversion Engine & Licensing
- **Question:** Which redistributable local engine should be used for Microsoft Office conversions (e.g. DOCX -> PDF, XLSX -> PDF) without requiring MS Office installed on the user's machine?
- **Options Considered:**
  1. *Headless LibreOffice / soffice:* High fidelity, but heavy binary (~150MB+ download or dependency).
  2. *Pure JS / WASM engines (e.g., docx-preview, pdf-lib, pandoc):* Lightweight, handles text, basic formatting, and PDF operations reliably, but complex Word art/macros have limitations.
  3. *Native Windows COM Automation:* Uses local Office if present; fails gracefully if absent.
- **Current Recommendation:** For MVP, support PDF, TXT, and basic DOCX with honest fidelity disclaimers; explore bundled lightweight WASM / Pandoc converters for advanced documents.

---

## 2. Default Destination Folder Behavior
- **Question:** Should converted files default to the same folder as the source file or to a dedicated output folder (e.g., `~/Downloads/RadialStudio` or `~/Converted`)?
- **Options Considered:**
  1. *Same folder as source (Current PRD default):* Convenient for fast in-place workflows, but can clutter original folders.
  2. *Dedicated output directory:* Keeps outputs organized in one place, easily accessible via "Open Output Folder".
  3. *Configurable with smart default:* Default to same folder with a setting in Dashboard to specify custom target.
- **Current Recommendation:** Option 3 (same folder by default, configurable in Settings).

---

## 3. Full-Text / Content Indexing in Dashboard
- **Question:** Should full-text search inside documents (e.g. searching keywords inside PDF or DOCX) be available in Phase 4 or deferred to post-MVP?
- **Options Considered:**
  1. *Metadata-only indexing for MVP:* Index filename, size, extension, modified date, category. Extremely fast, low CPU and battery usage.
  2. *Opt-in content indexing:* Allow user to enable content indexing on specific folders (e.g., Documents).
- **Current Recommendation:** Metadata indexing as default; content indexing strictly as an opt-in toggle per folder.

---

## 4. Startup & System Tray Behavior
- **Question:** Should Radial File Studio launch on Windows startup by default?
- **Options Considered:**
  1. *Disabled by default:* User explicitly opts in via Settings.
  2. *Prompted during onboarding:* User chooses during initial folder selection.
- **Current Recommendation:** Prompt during onboarding with a default of false (opt-in only).
