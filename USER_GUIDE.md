# CodeNotes — User Guide

Welcome to **CodeNotes**, a visual annotation tool built exclusively for VS Code. 

This guide covers everything you need to know to capture annotations, write Markdown notes, sketch visual diagrams, and work with layers directly on top of your code files.

---

## Table of Contents
1. [Core Philosophy & Workspace Setup](#1-core-philosophy--workspace-setup)
2. [Hover Notes (Text-Based Annotations)](#2-hover-notes-text-based-annotations)
3. [Draw Mode (Canvas-Based Annotations)](#3-draw-mode-canvas-based-annotations)
4. [Keyboard Shortcuts Reference](#4-keyboard-shortcuts-reference)
5. [Practical Workflows](#5-practical-workflows)
6. [Best Practices & Tips](#6-best-practices--tips)

---

## 1. Core Philosophy & Workspace Setup

### The "Non-Intrusive" Storage Model
Unlike typical code comment systems, CodeNotes **never modifies your source files**. Your files remain clean, compilation is unaffected, and you don't risk introducing syntax errors. 

All annotations are stored in a hidden `.codenotes/` directory created in your active workspace root:
- **Hover Notes** are stored in `.codenotes/notes.json`
- **Drawings** are stored in `.codenotes/drawings/drawings.json`
- **Pasted/Imported Images** are saved inside `.codenotes/drawings/assets/`

### Opening a Workspace
To use CodeNotes, **you must open a folder or workspace in VS Code**. If you open a standalone file (using `File -> Open File...` without a parent folder workspace), the extension will display a warning and fail to save your notes.

---

## 2. Hover Notes (Text-Based Annotations)

Hover Notes let you attach Markdown tooltips to specific lines of code.

### Adding a Note
1. Open a source file.
2. Click on the line of code you wish to annotate.
3. Right-click and select **CodeNotes: Add Note**, or press **`Ctrl+Alt+N`** (Windows/Linux) or **`Cmd+Alt+N`** (macOS).
4. A quick input box will appear at the top of the editor. Type your text and press **Enter**.
5. Once added, a yellow note icon (`note-icon.svg`) appears in the gutter next to the line number.

### Reading Notes
Hover your mouse pointer over any line containing a gutter note icon. A VS Code hover window will display the fully rendered Markdown content of your note.

### Editing a Note
There are two ways to edit notes:
- **From the Hover Window**: Hover over the line and click the blue **Edit** link at the bottom of the tooltip.
- **Using Shortcuts**: Click the line and press **`Ctrl+Alt+E`** / **`Cmd+Alt+E`**, or right-click and select **CodeNotes: Edit Note (Markdown)**.

This opens a side panel with a markdown-focused text editor. 
- You can write headers, lists, links, or code blocks in this panel.
- Save changes by pressing **`Ctrl+S`** / **`Cmd+S`** or clicking the **Save** button.

### Deleting a Note
- **From the Hover Window**: Click the **Delete** link at the bottom of the hover tooltip.
- **Using Context Menus**: Right-click the line and select **CodeNotes: Delete Note**.
- You will be asked to confirm deletion via a dialog box.

### The Explorer Sidebar
The **CodeNotes** panel is visible inside your VS Code Explorer sidebar.
- It aggregates every note in the current workspace folder.
- Notes are grouped by file.
- Clicking any note in the list opens that file and automatically scrolls the editor to reveal the annotated line.

### Content-Based Anchoring
CodeNotes uses **line-content anchoring**, not strict line numbers.
- When you create a note, CodeNotes records the trimmed text of the line (`anchorText`).
- If you insert code above the note, formatting changes shift the line, or lines are reordered, CodeNotes automatically searches outward (default ±60 lines, configurable) to locate the exact code text and re-anchor the note.
- **Orphaned Notes**: If the code line is completely deleted or edited beyond recognition, CodeNotes marks the note as *orphaned*. Gutter icons are hidden, and the note appears in the Explorer sidebar with a warning warning icon (`⚠`). You can click the orphaned note in the sidebar to view its text and decide whether to delete or manually re-attach it.

### Toggling Note Visibility
Need to read code without clutter? Press **`Ctrl+Alt+H`** / **`Cmd+Alt+H`** or click the **Toggle Notes Visibility** action. This hides all gutter icons and hover tooltips immediately without losing any saved data. Press the shortcut again to show them.

---

## 3. Draw Mode (Canvas-Based Annotations)

Draw Mode overlays a transparent whiteboard page directly on top of your code, allowing you to draw shapes, paste images, add text annotations, and use layers.

### Entering and Exiting Draw Mode
- **To Open**: Click the 🪣 (paintcan) icon in the top right editor toolbar, or press **`Ctrl+Alt+D`** / **`Cmd+Alt+D`**.
- **To Close**: Press the same shortcut, or simply close the Draw Mode editor tab.
- **What happens on open**: Draw Mode opens as a read-only, syntax-highlighted preview of the file. It automatically scrolls to align with the topmost visible line of the text editor you came from.
- **Autosave**: Any canvas drawing or editing operation automatically queues a debounced save. Closing the tab forces an immediate save.

---

### The Floating Toolbar

The Draw Mode UI features a floating toolbar containing styling options, tools, history, and zoom.

#### 1. Visual Tools
- **Select (Lasso) (`select`)**: Use this tool to lasso-select canvas elements. Draw a freehand line around any mix of strokes, shapes, text boxes, and images. 
  - Drag the selection box to move items.
  - Drag bounding box handles to resize shapes, text boxes, or images.
  - Press **`Delete`** or **`Backspace`** to delete the selection.
  - Press **`Ctrl+D`** / **`Cmd+D`** to duplicate the selection.
  - Double-click an existing text box in Select mode to edit its text.
- **Pen (`pen`)**: Standard freehand drawing. When using a stylus (e.g. tablet or touchscreen computer), it automatically detects pressure values from the Pointer Events API to create smooth, varying-width strokes. If drawing with a mouse, it falls back to a uniform stroke width.
- **Shapes (Line, Arrow, Rectangle, Ellipse)**: Click and drag to create shapes.
  - **Constraint Snapping**: Hold the **`Shift`** key while dragging to snap lines/arrows to 45-degree increments, constrain rectangles to perfect squares, or constrain ellipses to perfect circles.
- **Text Box (`text`)**: Click anywhere on the canvas to place a text box.
  - An inline text editor pops up. Type your note.
  - Press **`Ctrl+Enter`** / **`Cmd+Enter`** or click outside the text area to commit the text to the canvas.
  - Press **`Escape`** to cancel edits and close the text box.
  - You can change font size (Small, Medium, Large, Extra Large) and apply Bold using the toolbar.
- **Eraser**: Includes two options:
  - **Stroke Eraser**: Deletes the *entire* stroke/object if touched by the eraser cursor.
  - **Pixel Eraser**: Erases only the exact pixels under the cursor, splitting single strokes into multiple sub-strokes.
- **Insert Image (`image`)**: Imports image files onto the canvas. You can move, duplicate, delete, and resize imported images like any other shape.
  - **Methods**: Click the Image button to open a file picker, drag-and-drop an image file directly onto the window, or copy an image to your clipboard and paste it (`Ctrl+V` / `Cmd+V`).
  - **Image Cap**: To keep files lightweight, images wider or taller than 2000px are automatically downscaled.

#### 2. Styling Presets
- **Color Palette**: Choose between 5 preset colors (Red, Green, Blue, Orange, White). Clicking a color changes the active drawing color. If you have objects selected in Lasso mode, clicking a color updates all selected objects instantly.
- **Stroke Width**: Choose Thin (2px), Medium (4px), or Thick (8px). Similar to colors, selecting a width changes the default drawing width or updates selected shapes/strokes.
- **Text Styling**: Toggle Bold (`B`) or set font sizes: Small (`S` - 12px), Medium (`M` - 16px), Large (`L` - 20px), or Extra Large (`XL` - 24px).

#### 3. History Actions
- **Undo / Redo**: Revert or reapply actions using the toolbar buttons, or by pressing **`Ctrl+Z`** / **`Cmd+Z`** (Undo) and **`Ctrl+Shift+Z`** / **`Ctrl+Y`** (Redo).

#### 4. Zoom Controls
- Adjust zoom from **50% to 200%** using the zoom-in and zoom-out buttons.
- Alternatively, hold **`Ctrl`** or **`Cmd`** and roll your mouse scroll wheel to zoom.
- Double-click the percentage zoom label in the toolbar to reset zoom to **100%**.
- Zoom scales both the rendered source code text and all canvas drawings uniformly, keeping them aligned.

---

### Layers Management Panel

The Layers Panel floating window allows you to organize annotations onto separate transparent layers (e.g. one layer for pen arrows, another for text comments).

- **Active Layer**: The highlighted layer in the list. All new strokes, shapes, images, and text boxes are placed onto this active layer. Click a layer item to make it active.
- **Visibility Toggle**: Click the eye icon next to a layer to hide or show it. Hiding a layer hides its objects from the screen and disables lasso-selection on them.
- **Create Layers**: Click the **＋ New** button in the header, type a name, and press **Enter** (or click the checkmark).

---

## 4. Keyboard Shortcuts Reference

### Global Shortcuts

| Command | Action | Keybinding (Windows/Linux) | Keybinding (macOS) |
|---|---|---|---|
| `codenotes.addNote` | Add Hover Note | `Ctrl+Alt+N` | `Cmd+Alt+N` |
| `codenotes.editNote` | Edit Hover Note | `Ctrl+Alt+E` | `Cmd+Alt+E` |
| `codenotes.toggleVisibility` | Toggle Hover Notes Visibility | `Ctrl+Alt+H` | `Cmd+Alt+H` |
| `codenotes.draw.toggle` | Toggle Draw Mode | `Ctrl+Alt+D` | `Cmd+Alt+D` |

### Draw Mode Editor Shortcuts

| Action | Shortcut (Windows/Linux & macOS) |
|---|---|
| Undo | `Ctrl+Z` / `Cmd+Z` |
| Redo | `Ctrl+Shift+Z` / `Ctrl+Y` / `Cmd+Shift+Z` |
| Duplicate Selected | `Ctrl+D` / `Cmd+D` |
| Delete Selected | `Delete` / `Backspace` |
| Zoom In/Out | `Ctrl+Scroll` / `Cmd+Scroll` |
| Commit Textbox | `Ctrl+Enter` / `Cmd+Enter` |
| Cancel Textbox | `Escape` |
| Constrain drawing | Hold `Shift` |

---

## 5. Practical Workflows

### Example A: Diagramming a DSA Recursion Tree
1. Open your code file (e.g. containing a recursive binary search or merge sort).
2. Enter **Draw Mode** with `Ctrl+Alt+D`.
3. Create a new layer named "Recursion Flow".
4. Select the **Pen** tool and the **Blue** color preset. Sketch lines showing how activation records spawn.
5. Select the **Arrow** shape tool, hold **`Shift`** to snap your drawing straight down, and draw connections between your recursive calls.
6. Select the **Text** tool, click near the base case code, set it to **Bold**, and write `"Base Case Base Condition"` to label it.
7. Close the Draw Mode tab with `Ctrl+Alt+D` to return to your normal typing flow.

### Example B: Team Documentation sharing via Git
1. Open your project workspace.
2. Select a line of code containing a complex utility function.
3. Press `Ctrl+Alt+N` to write a Markdown hover note describing edge cases.
4. Press `Ctrl+Alt+E` to expand the note with bullet points or code examples.
5. In Draw Mode, use the **Rectangle** tool to highlight a performance-sensitive block.
6. Because all annotations live inside the `.codenotes/` directory, commit this folder to Git:
   ```bash
   git add .codenotes/
   git commit -m "docs: add visual diagrams and hover notes for core utility function"
   ```
7. When your teammates pull the changes, the hover notes and drawings will appear automatically on their machines!

---

## 6. Best Practices & Tips

- ** Stylus Palm Rejection**: CodeNotes has native palm rejection. If you start a stroke with a pen stylus, concurrent touch inputs from your hand resting on the screen are automatically blocked. You do not need to manually configure anything.
- **Autosave and Backup**: Autosave writes data to `.codenotes/` every 500ms after you stop drawing. If you close the panel or switch tabs, it forces an immediate save, ensuring no drawing strokes are lost.
- **Git Ignoring Local Notes**: If you do not want your personal study diagrams to be shared with the team, simply add `.codenotes/` to your workspace `.gitignore` file:
  ```ignore
  # Ignore personal CodeNotes drawings and tooltips
  .codenotes/
  ```
- **External edits**: Do not worry if you edit code files outside Draw Mode. When you return to Draw Mode, the background syntax-highlighted code refreshes automatically while your drawings remain positioned precisely at their saved line offsets.
