# Converter Capability Matrix & Engine Licensing

---

## 1. Phase-Wise Format Support Matrix

| Category | Input Formats (MVP) | Target Formats (MVP) | Proposed Engine | Redistribution & License |
|---|---|---|---|---|
| **Images** | PNG, JPEG, JPG, WEBP, BMP | PNG, JPEG, WEBP, BMP | `sharp` (libvips) / pure image WASM | Apache 2.0 / LGPL (fully redistributable) |
| **Video** | MP4, WEBM, MOV, MKV, AVI | MP4 (H.264/AAC), WEBM (VP9) | Bundled static FFmpeg (non-GPL build) | LGPL v2.1+ |
| **Documents** | PDF, DOCX, TXT | PDF, TXT, DOCX | Node/WASM document pipeline (`pdf-lib`, `docx`) | MIT / Apache 2.0 |

---

## 2. Capability Registry Rules

1. **Same-Format Handling:** If an input file is dropped onto a target format that matches its current format (e.g. `image.png` dropped on `PNG`), the registry flags it as `NO_OP_SAME_FORMAT` or prompts for optional compression. It never runs a redundant lossy re-encode silently.
2. **Unsupported File Handling:** If a file category is unsupported (e.g., `.zip`, `.exe`, `.iso`), the radial ring collapses and the central circle displays a clear warning pill: `Unsupported file format. Radial Studio currently converts Images, Videos, and Documents.`
3. **Multi-File Mixed Batch Handling:** If multiple files are dragged at once:
   - If all files share the same category (e.g. 5 PNG images), the full compatible target ring is enabled.
   - If files have mixed categories, the app highlights the conflict and prompts the user to convert compatible files or drop individually.
