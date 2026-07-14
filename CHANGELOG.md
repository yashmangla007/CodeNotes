# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

This is the initial production release of CodeNotes, featuring both text-based **Hover Notes** and canvas-based **Draw Mode** annotations.

### Added
- **Hover Notes**:
  - Ability to attach Markdown notes directly to any line of code.
  - Interactive tooltips showing formatted Markdown with Edit and Delete options.
  - Side panel editor supporting full Markdown formatting, preview, and manual saves.
  - Explorer tree sidebar grouping all notes by file for quick navigation.
  - Gutter decorations and overview ruler markers highlighting annotated lines.
  - Content-based re-anchoring algorithm matching line text contents within a configurable search window (default $\pm$ 60 lines) on load.
  - Orphan note detection highlighting notes whose anchor lines have been removed or heavily edited.
  - Note visibility toggle commands (`Ctrl+Alt+H` / `Cmd+Alt+H`) to show/hide gutter decorators.
- **Draw Mode**:
  - Transparent dual-canvas drawing overlay layered above a read-only code view.
  - Floating visual toolbar containing presets for tools, stroke widths, font sizes, and colors.
  - **Pen tool** utilizing `perfect-freehand` for pressure-sensitive freehand sketches.
  - **Shape tools** for drawing lines, arrows, rectangles, and ellipses.
  - **Shift-constrain snapping** for geometric shapes (locks lines to 45-degree angles, forces squares, and constrains circles).
  - **Text box tool** supporting inline text areas, font size options, bold toggles, and direct text positioning.
  - **Lasso selection tool** supporting multi-object bounding boxes, resizing, translations, duplication (`Ctrl+D`), and deletion.
  - **Eraser tools** supporting both whole-object stroke deletion and pixel-based stroke splitting.
  - **Image insertion pipeline** allowing clipboard copy-paste, drag-and-drop, or manual file picking with a automatic 2000px dimension cap.
  - **Layers control panel** to organize annotations, create named layers, toggle layer visibility, and assign active layers.
  - Session-level undo and redo stack supporting canvas-wide operations.
  - Zoom scaling from 50% to 200% via mouse buttons, scroll shortcuts, and double-click to reset.
  - Strict Content Security Policy (CSP) blocking external scripts, styles, connection queries, and remote image sources.
  - Document-relative coordinate persistence saving elements at a fixed zoom reference level.
  - Local asset folder writing to store imported canvas images offline.
  - External modification detection refreshing syntax-highlighted code when underlying files change without wiping drawn annotations.

### Fixed
- **Palm Rejection**: Added palm rejection pointer validation to the Text Tool, preventing hand touch events from spawning text boxes when a stylus pen is active.
- **Save Notifications**: Fixed stale toast notification states in the webview, ensuring save error alerts are cleared during panel re-initialization and cleanup commands are sent to the webview on panel disposal.
- **Layout Adjustments**: Resolved 1-frame layout shifts in the code editor viewport during toolbar resizing/wrapping by applying a smooth CSS padding-top transition.
