# CodeNotes — A Layer of Knowledge Over Your Code

> **Attach Markdown notes and freehand drawings to any file in VS Code — without touching your source.**

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](#)
[![VS Code](https://img.shields.io/badge/vscode-%5E1.85.0-007ACC.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#license)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

---

## What is CodeNotes?

CodeNotes is a VS Code extension with two complementary annotation tools that work entirely within your editor, never modifying your source files:

1. **Hover Notes** — attach a Markdown note to any line of code. The note survives file edits through content-based anchoring and appears on hover.
2. **Draw Mode** — toggle a full pen/drawing canvas directly over a read-only, syntax-highlighted view of your file. Circle functions, draw arrows between variables, write margin notes — exactly like annotating a printed page.

All annotations are stored in a `.codenotes/` folder inside your workspace, completely separate from your source files.

---

## Demo

> *Replace the placeholders below with screenshots or GIF recordings.*

| Hover Notes | Draw Mode |
|---|---|
| `[screenshot: hover tooltip with rendered Markdown]` | `[screenshot: freehand pen strokes over TypeScript code]` |
| `[screenshot: CodeNotes sidebar grouped by file]` | `[screenshot: shapes and text annotation with layers panel]` |

---

## Why CodeNotes Exists

Students and developers who use a stylus or tablet to study code face an uncomfortable choice:

- **Paper or another app** (OneNote, GoodNotes) — disconnected from the code, out of sync the moment anything changes.
- **Comments in the source** — clutter the file, can't be visual, must be stripped before sharing.
- **Screenshotting into a note app** — static, immediately stale, requires leaving the editor.

CodeNotes closes that gap: annotate code the way you annotate a textbook, from inside VS Code, with a real pen. Notes and drawings are paired to the file, persist across restarts, and never touch the file they describe.

---

## Features

### Hover Notes

| Feature | Detail |
|---|---|
| **Add a note** | Right-click → `CodeNotes: Add Note` or `Ctrl+Alt+N` |
| **Edit as Markdown** | Opens a side panel with a textarea; save with `Ctrl+S` / `Cmd+S` |
| **Hover to read** | Rendered Markdown with inline Edit / Delete links |
| **Delete a note** | Right-click → `CodeNotes: Delete Note` |
| **Toggle visibility** | `Ctrl+Alt+H` hides/shows all note decorations without deleting data |
| **Sidebar** | "CodeNotes" panel in the Explorer — every note grouped by file, click to jump |
| **Content-based anchoring** | Notes survive insertions and reformats by searching ±60 lines for their anchor text |
| **Orphan detection** | Notes whose anchor text cannot be found are marked ⚠ in the sidebar instead of silently misattaching |

### Draw Mode

| Feature | Detail |
|---|---|
| **Pen tool** | Freehand strokes; real pressure-sensitive width variation when a stylus reports pressure |
| **Palm rejection** | `pointerType === "touch"` events are ignored while a pen pointer is active — no configuration required |
| **Shapes** | Line, Arrow, Rectangle, Ellipse; hold **Shift** to constrain proportions or angle |
| **Text boxes** | Click to place, type directly; `Ctrl+Enter` / `Cmd+Enter` to commit, `Escape` to cancel; supports Bold and four font sizes (12 / 16 / 20 / 24 px) |
| **Eraser** | Two modes: **Stroke Eraser** (removes whole strokes it touches) and **Pixel Eraser** (splits a stroke at the erased segment) |
| **Select / Lasso** | Freehand polygon selects any mix of strokes, shapes, text boxes, and images; drag to move, drag handles to resize, `Delete` / `Backspace` to delete, `Ctrl+D` to duplicate |
| **Color palette** | 5 preset colors (Red, Green, Blue, Orange, White) applied to the active tool and to any selected objects |
| **Stroke width** | Thin / Medium / Thick presets |
| **Image import** | Paste (`Ctrl+V`), drag-and-drop a file, or use the toolbar button. Images are capped at 2000 px on their longest side before saving |
| **Layers** | Create named layers, toggle visibility independently, assign new objects to the active layer |
| **Undo / Redo** | `Ctrl+Z` / `Cmd+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` — session-level, covering all object operations |
| **Zoom** | 50%–200% in 10% steps via toolbar buttons; `Ctrl+Scroll` to zoom; double-click the zoom label to reset to 100% |
| **Save-failure surfacing** | Any write failure shows a non-blocking toast in the webview; annotations are never silently discarded |
| **External edit detection** | If you edit the underlying file while Draw Mode is open, the code view refreshes automatically without discarding drawings |

---

## Architecture Overview

```
CodeNotes Extension (Node.js / Extension Host)
│
├── extension.ts                   — activation, command registration
├── anchor.ts                      — content-based line-anchoring algorithm
├── decorationManager.ts           — gutter icons, overview ruler, re-anchor on save
├── hoverProvider.ts               — Markdown hover rendering
├── editPanel.ts                   — side-panel Markdown editor for notes
├── noteStore.ts                   — persistence: .codenotes/notes.json
├── notesTreeProvider.ts           — Explorer sidebar tree
├── types.ts                       — CodeNote / NotesFile interfaces
│
└── draw/
    ├── drawCommands.ts            — toggle command, keybinding handler
    ├── drawCustomEditorProvider.ts — VS Code Custom Readonly Editor Provider
    ├── drawStore.ts               — persistence: .codenotes/drawings/drawings.json
    ├── drawTypes.ts               — all shared types + host ↔ webview message protocol
    └── webview/                   — self-contained webview app (esbuild bundle)
        ├── main.ts                — entry point, message bridge, toolbar, layers panel
        ├── codeRenderer.ts        — highlight.js syntax highlighting, per-line DOM layout
        ├── canvasEngine.ts        — two-canvas drawing surface (committed + active)
        ├── penTool.ts             — pressure input → perfect-freehand stroke geometry
        ├── eraserTool.ts          — stroke and pixel erase modes
        ├── shapeTool.ts           — line / arrow / rectangle / ellipse with Shift snap
        ├── textTool.ts            — inline textarea-based text box creation and editing
        ├── lassoTool.ts           — pointer routing for lasso / move / resize gestures
        ├── selectionManager.ts    — selection state, bounding box, handle hit-testing
        ├── selectionHandle.ts     — geometry helpers (polygon intersection, BB, handles)
        ├── objectTransforms.ts    — translate / scale transforms for selected objects
        ├── objectStore.ts         — in-memory source of truth for all DrawObjects
        ├── historyManager.ts      — undo/redo stack (DrawObject[] snapshots)
        └── uuid.ts                — browser-compatible UUID generation
```

### Key Architectural Decisions

**Draw Mode is a Custom Editor, not an overlay.**
VS Code's extension API does not support injecting a canvas on top of the live Monaco editor. Draw Mode opens as a separate tab (a `vscode.CustomReadonlyEditorProvider`) containing a webview that renders the code itself as read-only syntax-highlighted HTML, with a `<canvas>` positioned absolutely inside the same scrollable container. Both layers scroll together natively — no cross-window scroll synchronisation is needed.

**Coordinate space is file-relative, not screen-relative.**
All object positions are stored in document space (pixels at a fixed reference font size). A single `zoomScale` factor applied at render time scales both the rendered code text and every canvas object together. Raw pixel coordinates are never persisted.

**Everything is local and offline.**
No network requests are made from either the extension host or the webview. No telemetry. No remote asset loading. Syntax highlighting (highlight.js) and stroke smoothing (perfect-freehand) are bundled with the extension.

**The source file is never touched.**
All writes go through `vscode.workspace.fs.writeFile` targeting only the `.codenotes/` directory. There is no code path that writes to a user source file.

---

## Quick Start

### Run from source (Extension Development Host)

```bash
git clone <repo-url>
cd CodeNotes/codenotes-extension
npm install
npm run compile
```

Press **F5** in VS Code (with the `codenotes-extension` folder open as the workspace) to launch a new Extension Development Host window.

### Try Hover Notes

1. Open any source file in the Extension Development Host.
2. Click on a line, then right-click → **CodeNotes: Add Note** (or press `Ctrl+Alt+N`).
3. Type a quick note and press Enter.
4. Hover the annotated line to read it. Open the **CodeNotes** panel in the Explorer sidebar to see all notes grouped by file.

### Try Draw Mode

1. Open any source file in the Extension Development Host.
2. Press `Ctrl+Alt+D` (Windows/Linux) or `Cmd+Alt+D` (macOS), or click the 🪣 icon in the editor title bar.
3. Select a tool from the floating toolbar and draw on the canvas.
4. Press `Ctrl+Alt+D` again (or close the Draw Mode tab) to return to the normal editor. Drawings are saved automatically.

---

## Installation

### Build a `.vsix` package

```bash
# Install the VS Code Extension CLI if you don't have it
npm install -g @vscode/vsce

# From inside codenotes-extension/
npm install
npm run compile
vsce package
```

This produces `codenotes-0.1.0.vsix`. Install it from the VS Code command palette:

```
Extensions: Install from VSIX...
```

or via the command line:

```bash
code --install-extension codenotes-0.1.0.vsix
```

> **Note:** The extension is not yet published to the VS Code Marketplace. Install from VSIX as described above.

---

## Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- VS Code ≥ 1.85.0

### Build Scripts

| Command | What it does |
|---|---|
| `npm run compile` | Full build: TypeScript (extension host) + esbuild (webview bundle) |
| `npm run compile:host` | Extension host only (`tsc -p ./`) |
| `npm run compile:webview` | Webview bundle only (esbuild → `out/webview/main.js`) |
| `npm run watch` | Watch mode for the extension host TypeScript |
| `npm run vscode:prepublish` | Alias for `compile`, called automatically by `vsce package` |

> **Webview watch mode:** There is no bundler watch for the webview. Re-run `npm run compile:webview` manually after editing any file under `src/draw/webview/`.

### Folder Structure

```
CodeNotes/
├── PRD.md                         — Product Requirements Document
├── TRD.md                         — Technical Requirements Document
├── FINAL_AUDIT_REPORT.md          — Pre-release quality audit (8.5/10, Ready after Minor Fixes)
└── codenotes-extension/
    ├── package.json               — Extension manifest, commands, keybindings, build scripts
    ├── tsconfig.json              — Host TypeScript config (excludes src/draw/webview)
    ├── .vscodeignore              — Files excluded from the packaged .vsix
    ├── src/                       — TypeScript source (extension host + webview)
    ├── out/                       — Compiled output (not committed)
    │   ├── extension.js
    │   └── webview/main.js
    └── media/
        ├── note-icon.svg          — Gutter decoration for annotated lines
        └── note-icon-orphaned.svg — Gutter decoration for orphaned notes
```

### Content Security Policy

The Draw Mode webview enforces a strict CSP. No relaxation is acceptable:

```
default-src 'none';
script-src 'nonce-<random-per-open>';
style-src 'unsafe-inline';
img-src <webview-csp-source> data:;
font-src 'none';
connect-src 'none';
```

All images inserted by the user are loaded via `webview.asWebviewUri()` pointing to local asset files — never as remote URLs.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Extension host | TypeScript + Node.js | Matches VS Code's tooling; type safety across the message boundary |
| Webview | TypeScript bundled with esbuild | Fast bundling; no framework overhead; runs in VS Code's Chromium runtime |
| Syntax highlighting | [highlight.js](https://highlightjs.org/) v11 | Fully offline; 24-language explicit map with auto-detect fallback; no network dependency |
| Stroke rendering | [perfect-freehand](https://github.com/steveruizok/perfect-freehand) v1 | Turns pointer pressure samples into smooth stroke outlines without custom smoothing math |
| Pointer input | Native Pointer Events API | Provides `pointerType`, `pressure`, and `getCoalescedEvents` — fully supported in VS Code's Chromium webview |
| Persistence | Plain JSON + separate image asset files | Human-readable, diffable, no database dependency; images never base64-inlined in JSON |

---

## Data Format

### Hover Notes — `.codenotes/notes.json`

```json
{
  "version": 1,
  "notes": [
    {
      "id": "uuid",
      "filePath": "src/index.ts",
      "line": 41,
      "anchorText": "function loadConfig() {",
      "note": "Reads config from disk; falls back to defaults if missing.",
      "createdAt": "2026-07-11T00:00:00.000Z",
      "updatedAt": "2026-07-11T00:00:00.000Z",
      "orphaned": false
    }
  ]
}
```

### Draw Mode — `.codenotes/drawings/drawings.json`

```json
{
  "version": 1,
  "files": {
    "src/index.ts": {
      "filePath": "src/index.ts",
      "pageHeightLines": 120,
      "layers": [
        { "id": "default", "name": "Default", "visible": true, "order": 0 }
      ],
      "objects": [
        {
          "id": "uuid",
          "type": "stroke",
          "tool": "pen",
          "layerId": "default",
          "color": "#e06c75",
          "baseWidth": 4,
          "opacity": 1,
          "points": [{ "x": 120, "y": 340, "pressure": 0.72 }],
          "createdAt": "2026-07-11T00:00:00.000Z",
          "updatedAt": "2026-07-11T00:00:00.000Z"
        }
      ]
    }
  }
}
```

Inserted images are stored as separate files under `.codenotes/drawings/assets/<uuid>.<ext>` and referenced by filename in the JSON. Both files are safe to commit to version control. Add `.codenotes/` to `.gitignore` to keep annotations local and personal.

---

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `codenotes.anchorSearchWindow` | `number` | `60` | Lines above/below the last known position to search when re-anchoring a note whose line has moved |
| `codenotes.showGutterIcon` | `boolean` | `true` | Show a gutter icon next to lines that have a note |

---

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Add Note | `Ctrl+Alt+N` | `Cmd+Alt+N` |
| Edit Note (Markdown) | `Ctrl+Alt+E` | `Cmd+Alt+E` |
| Toggle Notes Visibility | `Ctrl+Alt+H` | `Cmd+Alt+H` |
| **Toggle Draw Mode** | **`Ctrl+Alt+D`** | **`Cmd+Alt+D`** |

**Inside Draw Mode:**

| Action | Shortcut |
|---|---|
| Undo | `Ctrl+Z` / `Cmd+Z` |
| Redo | `Ctrl+Shift+Z` · `Ctrl+Y` / `Cmd+Shift+Z` |
| Duplicate selection | `Ctrl+D` / `Cmd+D` |
| Delete selection | `Delete` / `Backspace` |
| Commit text box | `Ctrl+Enter` / `Cmd+Enter` |
| Cancel text box | `Escape` |
| Zoom | `Ctrl+Scroll` / `Cmd+Scroll` |
| Reset zoom to 100% | Double-click the zoom label |
| Constrain shape (Shift-snap) | Hold `Shift` while drawing |

---

## Explicit Non-Goals (v1)

These features were deliberately excluded and will not be accepted as contributions without a new design review:

| Not in scope | Reason |
|---|---|
| Handwriting-to-text (OCR) | Requires a separate ML subsystem; not core to usefulness |
| Real-time multi-device sync | Requires a backend service; CodeNotes is local-only |
| Infinite canvas beyond file length | Breaks the "paper bound to file" scroll model |
| Rich pressure-based ink textures (GoodNotes-style) | Visual fidelity rabbit hole |
| Editing code from within Draw Mode | Draw Mode is intentionally read-only |
| Refactor-aware drawing anchoring | Objects stay at their line position; they do not follow moved functions |
| Network requests of any kind | The extension is fully offline; no telemetry |

---

## Roadmap

The following are post-v1 candidates. None are committed.

- [ ] VS Code Marketplace publication
- [ ] Highlighter tool (semi-transparent, drawn behind other strokes)
- [ ] Object rotation via resize handle
- [ ] CI: `vsce package` on GitHub Actions
- [ ] Multi-root workspace polish
- [ ] Viewport spatial culling (QuadTree) for performance at large object counts
- [ ] VS Code CSS variable integration in the Draw Mode UI chrome

---

## Known Limitations

- **Single active workspace folder** is the primary supported case. Multi-root workspaces will not crash, but cross-folder behaviour is not polished.
- **VS Code for the Web** is out of scope for v1. The Custom Editor API and Pointer Events API behave differently in the browser host and have not been validated there.
- **Undo history is session-scoped.** Closing and reopening Draw Mode clears the undo stack; the persisted object list is restored correctly, but individual undo steps are not.
- **Drawing positions do not track code edits.** If you add or remove lines above an annotation outside Draw Mode, drawings remain at their original line positions. This is a deliberate tradeoff — see the "Paper Model" in the PRD.
- **highlight.js auto-detection** is used as a fallback for languages not in the explicit 24-language map. Auto-detection can occasionally misidentify a file. Setting the correct language mode in VS Code before toggling Draw Mode produces the best results.

---

## Credits

- **[perfect-freehand](https://github.com/steveruizok/perfect-freehand)** by Steve Ruiz — the pressure-to-stroke-outline library that makes pen input feel natural without custom smoothing math.
- **[highlight.js](https://highlightjs.org/)** — offline syntax highlighting inside the webview.
- VS Code's **Custom Editor API** — the architectural foundation that makes a legitimate, supported annotation overlay possible without DOM-patching hacks.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

> **A note on source file safety:** No code path in this extension writes to, modifies, or updates the modification timestamp of any user source file. All persistence targets `.codenotes/` exclusively via `vscode.workspace.fs.writeFile`. If you ever observe otherwise, please file a bug immediately.
