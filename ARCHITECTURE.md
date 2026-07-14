# CodeNotes — Internal Architecture

This document describes the internal architecture of the CodeNotes VS Code extension for engineers who maintain, extend, or debug it. Every claim in this document is grounded in the actual implementation in `src/`.

---

## Table of Contents

1. [High-Level Structure](#1-high-level-structure)
2. [Custom Editor Lifecycle](#2-custom-editor-lifecycle)
3. [Webview Lifecycle](#3-webview-lifecycle)
4. [Host ↔ Webview Communication Protocol](#4-host--webview-communication-protocol)
5. [Drawing Pipeline](#5-drawing-pipeline)
6. [Rendering Engine](#6-rendering-engine)
7. [Object Model](#7-object-model)
8. [Layers](#8-layers)
9. [Selection System](#9-selection-system)
10. [Zoom](#10-zoom)
11. [Persistence](#11-persistence)
12. [Image Import Pipeline](#12-image-import-pipeline)
13. [Content Security Policy](#13-content-security-policy)
14. [Hover Notes Module](#14-hover-notes-module)
15. [Design Decisions and Their Rationale](#15-design-decisions-and-their-rationale)

---

## 1. High-Level Structure

The extension is composed of two independent but coordinated subsystems sharing a single activation path.

```
src/
├── extension.ts                  Activation entry point
│
├── (Hover Notes module)
│   ├── types.ts
│   ├── noteStore.ts
│   ├── anchor.ts
│   ├── decorationManager.ts
│   ├── hoverProvider.ts
│   ├── editPanel.ts
│   └── notesTreeProvider.ts
│
└── draw/                         Draw Mode module
    ├── drawTypes.ts              Shared types + message protocol
    ├── drawCommands.ts           Toggle command registration
    ├── drawStore.ts              Persistence manager
    ├── drawCustomEditorProvider.ts  Custom Editor Provider
    └── webview/                  Webview app (compiled separately by esbuild)
        ├── main.ts               Entry point, toolbar, layers panel, message handler
        ├── codeRenderer.ts       Syntax highlighting, per-line DOM layout
        ├── canvasEngine.ts       Two-canvas surface, rendering dispatch
        ├── penTool.ts            Pointer Events → perfect-freehand stroke geometry
        ├── eraserTool.ts         Stroke and pixel erase modes
        ├── shapeTool.ts          Geometric shapes with Shift-constraint snapping
        ├── textTool.ts           Inline textarea editing, text object lifecycle
        ├── lassoTool.ts          Pointer routing: lasso / move / resize gestures
        ├── selectionManager.ts   Selection state, BB rendering, transforms
        ├── selectionHandle.ts    Geometry utilities (polygon intersection, handles)
        ├── objectTransforms.ts   Translate and scale mutations for selected objects
        ├── objectStore.ts        In-memory authoritative object list
        ├── historyManager.ts     Undo/redo stack (snapshot-based)
        └── uuid.ts               Browser-compatible UUID generation
```

**Compilation:** The extension host is compiled by `tsc` into CommonJS (`out/*.js`). The webview is compiled separately by esbuild into a single IIFE bundle (`out/webview/main.js`). The two build products never share a module graph — their only connection is the typed message protocol in `drawTypes.ts`.

---

## 2. Custom Editor Lifecycle

Draw Mode is implemented as a `vscode.CustomReadonlyEditorProvider`. This is not a live-editable custom editor — it renders the underlying file read-only. The provider is registered in `drawCommands.ts`:

```typescript
vscode.window.registerCustomEditorProvider(
  DrawCustomEditorProvider.viewType,   // "codenotes.drawEditor"
  provider,
  {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  }
)
```

- **`retainContextWhenHidden: true`**: The webview's JavaScript context is preserved when the tab is not active. This ensures that in-progress undo stacks and selection state are not destroyed when the user switches tabs. This is a deliberate memory tradeoff — see §15.
- **`supportsMultipleEditorsPerDocument: false`**: Only one Draw Mode panel may exist per file at a time.

### `openCustomDocument(uri)`

This method is trivially implemented. Because the extension is a `CustomReadonlyEditorProvider`, the "document" concept is lightweight:

```typescript
return { uri, dispose: () => {} };
```

No custom document parsing or locking is required. All state is managed in `DrawStore` (extension host) and the webview's in-memory `ObjectStore`.

### `resolveCustomEditor(document, webviewPanel)`

This is the main setup method, called once per panel open. It performs these actions in order:

1. Sets `webviewPanel.webview.options` — enables scripts, restricts `localResourceRoots` to the extension URI and workspace folder URIs.
2. Calls `getWebviewHtml()` and assigns the returned HTML string to `webviewPanel.webview.html`. This causes Chromium to render the webview.
3. Registers the panel in the `openPanels` Map (`uri.toString() → OpenPanel`).
4. Attaches `onDidDispose` to clean up, force-save, and restore `DrawStore` callbacks.
5. Attaches `onDidReceiveMessage` to handle all messages from the webview.
6. Attaches a `vscode.workspace.onDidChangeTextDocument` watcher for external edit detection.
7. Installs `drawStore.onSaveError` and `drawStore.onSaveSuccess` callbacks that forward save events into the webview as typed messages.

### Toggle Command

The toggle command in `drawCommands.ts` manages the open/close lifecycle from the user side:

```
User presses Ctrl+Alt+D
       ↓
Determine active text editor URI
       ↓
If Draw Mode already open for that URI → call provider.close(uri)
       ↓
Otherwise → capture editor.visibleRanges[0].start.line as initialScrollLine
          → call provider.setInitialScrollLine(uri, line)
          → execute vscode.openWith(uri, "codenotes.drawEditor")
```

The `initialScrollLine` is stored in `pendingScrollLines: Map<string, number>` on the provider and consumed once inside `sendInit()`.

### Cleanup on Dispose

When the webview panel is closed (by the user or by the second toggle press), `onDidDispose` fires. It:
1. Removes the panel from `openPanels`.
2. Calls `drawStore.forceSave(uri)` — synchronous, bypasses the 500ms debounce timer.
3. Disposes all `disposables` registered during `resolveCustomEditor`.
4. Restores the previous `drawStore.onSaveError` and `drawStore.onSaveSuccess` callbacks — this handles the edge case where multiple panels across different files share the same `DrawStore` instance.

---

## 3. Webview Lifecycle

The webview application is a standard TypeScript browser application bundled by esbuild. Its entry point is `src/draw/webview/main.ts`.

### Initialization Sequence

```
Webview DOM ready
       ↓
main.ts top-level code runs
       ↓
vscode.postMessage({ type: "ready" })
       ↓
Host receives "ready", calls sendInit()
       ↓
Host reads source file via vscode.workspace.fs.readFile()
Host loads drawings from DrawStore.getDrawing(uri)
Host constructs init message with { document, sourceCode, languageId, initialScrollLine, baseAssetUri }
Host calls webview.postMessage(initMsg)
       ↓
Webview receives "init"
  → dismissActiveToast() (clears any stale toast from a prior session)
  → renderCode(codeContainer, sourceCode, languageId)
  → requestAnimationFrame:
      scrollToLine(codeContainer, initialScrollLine, zoomScale)
      initCanvas(document)
```

`initCanvas()` is guarded by a `if (engine !== null) return` check — double-init is impossible even if the host sends `init` twice.

### initCanvas() Responsibilities

`initCanvas()` instantiates all tools and wires all dependencies in a fixed order:

1. Create `CanvasEngine(codeContainer)`.
2. Load existing objects via `engine.loadDocument(document, baseAssetUri)`.
3. Wire `engine.onChanged` → `triggerDocumentChanged()` (debounced save).
4. Create `SelectionManager`, wire its callbacks into `engine`.
5. Create `PenTool(engine)`, `EraserTool(engine)`, `ShapeTool(engine)`, `TextTool(engine)`.
6. Create `LassoTool(engine, selectionManager, store, history, onNeedsRedraw, onCommitChange)`.
7. Wire double-click on canvas → text box editing in select mode.
8. Call `createToolbar()` — builds all DOM buttons, wires event listeners.
9. Wire keyboard shortcuts on `window`.
10. Sync layer state from the loaded document into the engine and `selectionManager`.
11. Call `createLayersPanel()`.

After this point the UI is fully interactive.

### External Edit Handling

`resolveCustomEditor` registers a `vscode.workspace.onDidChangeTextDocument` listener. When the underlying file changes while the panel is open:

```typescript
webviewPanel.webview.postMessage({ type: "sourceChanged", sourceCode: e.document.getText() })
```

The webview handler for `sourceChanged`:

```typescript
const scrollTop = codeContainer.scrollTop;
renderCode(codeContainer, msg.sourceCode, currentLanguageId);
requestAnimationFrame(() => {
  codeContainer.scrollTop = scrollTop;  // restore scroll position
  engine?.resize();                      // re-anchor canvas to refreshed DOM
});
```

Drawings are unaffected — only the code layer refreshes.

---

## 4. Host ↔ Webview Communication Protocol

All messages are typed in `src/draw/drawTypes.ts`. Neither side sends untyped objects.

### Host → Webview (`HostToWebviewMessage`)

| `type` | Payload | Purpose |
|---|---|---|
| `init` | `document`, `sourceCode`, `languageId`, `initialScrollLine`, `baseAssetUri?` | Full initialization on panel open |
| `sourceChanged` | `sourceCode` | Underlying file was edited externally |
| `requestSave` | — | Reserved; host can request an explicit save |
| `saveFailed` | `error: string` | Persistence write failed; webview shows toast |
| `saveSuccess` | — | Persistence write succeeded; dismisses toast |
| `imageImported` | `assetPath`, `webviewUri`, `width`, `height`, `x?`, `y?` | Host has written the image asset; webview creates `ImageObject` |

### Webview → Host (`WebviewToHostMessage`)

| `type` | Payload | Purpose |
|---|---|---|
| `ready` | — | Webview DOM ready; request `init` |
| `documentChanged` | `document: FileDrawingDocument` | Object state changed; host should persist |
| `requestImageImport` | `dataUrl`, `suggestedExt`, `width`, `height`, `x?`, `y?` | Webview has image data; host should write file |
| `log` | `level`, `message` | Forward console output to the extension host output channel |

### Key Invariant

**The webview never accesses the filesystem directly.** All file operations — reading source code, writing `drawings.json`, writing image assets — are performed by the extension host. This is a hard security boundary enforced by VS Code's webview isolation model.

---

## 5. Drawing Pipeline

Each tool follows the same event-dispatch contract: attach to the active canvas, receive pointer events, transform them into mutations on the `ObjectStore`, trigger a redraw, and call `engine.onChanged()` to queue a save.

### Pen Tool: Full Stroke Lifecycle

```
pointerdown on activeCanvas
  └─ PenTool.onPointerDown(e)
       Palm rejection check: if pointerType==="touch" && activePenPointerId !== null → return
       Track activePenPointerId if pointerType==="pen"
       currentPoints = [extractPoint(e)]
       canvas.setPointerCapture(e.pointerId)

pointermove on activeCanvas
  └─ PenTool.onPointerMove(e)
       Collect coalesced events via e.getCoalescedEvents() (when available)
       Push extracted points into currentPoints
       engine.renderActiveStroke(currentPoints, color, width, last=false)
         └─ activeCtx.clearRect(...)
            activeCtx.scale(zoomScale, zoomScale)
            buildStrokePath(points, width, last=false) → Path2D via perfect-freehand
            activeCtx.fill(path)

pointerup on activeCanvas
  └─ PenTool.onPointerUp(e)
       Push final point
       engine.renderActiveStroke(currentPoints, color, width, last=true)  // caps stroke tip
       engine.commitStroke(currentPoints, color, width)
         └─ ObjectStore.add(StrokeObject)
            HistoryManager.pushAction({ before, after })
            engine.onChanged?.()  // queues debounced save
            redrawCommitted()     // rebuilds committed canvas
       Reset: isDrawing=false, activePointerId=null, currentPoints=[]
```

### Palm Rejection (TRD §6.3)

All five tools (`PenTool`, `EraserTool`, `ShapeTool`, `TextTool`, `LassoTool`) independently implement the same pattern:

```typescript
// In onPointerDown:
if (e.pointerType === "touch" && this.activePenPointerId !== null) { return; }
if (e.pointerType === "pen") { this.activePenPointerId = e.pointerId; }

// In onPointerUp / onPointerCancel:
if (e.pointerType === "pen" && e.pointerId === this.activePenPointerId) {
  this.activePenPointerId = null;
}
```

Mouse events are never blocked. The `activePenPointerId` field tracks the pen's live pointer ID — not just a boolean — to correctly handle multi-pointer scenarios.

### Pressure Handling (TRD §6.4)

`PenTool.extractPoint(e)` reads `e.pressure` directly. The `perfect-freehand` library is initialized with `simulatePressure: false`, meaning it uses the raw pressure values from the Pointer Events API. Devices without pressure support (including most mice) report a constant `0.5` — this is treated as uniform pressure, producing constant-width strokes.

### Eraser: Two Modes

The `EraserTool` delegates all geometry to `engine.eraseAlongSegment(start, end, radius, mode)`:

- **`"stroke"` mode**: Tests each `StrokeObject`'s bounding box and sampled points against the eraser circle. If any point falls within the radius, the entire stroke is removed via `ObjectStore.remove([id])`.
- **`"pixel"` mode**: For each intersecting stroke, splits the `points` array at the segment boundary and replaces the original stroke with two (or more) sub-strokes via `ObjectStore.replaceWithMany(id, [...])`. Each sub-stroke gets a new UUID.

Both modes are wrapped in a gesture that captures history:
```
engine.startEraseGesture()   → stores beforeEraseSnapshot
  ... series of eraseAlongSegment calls ...
engine.commitEraseGesture()  → pushes HistoryAction { before: snapshot, after: current }
                                calls engine.onChanged()
```

---

## 6. Rendering Engine

`CanvasEngine` manages two `<canvas>` elements stacked inside a `<div id="canvas-host">` that is positioned absolutely inside `#code-container`:

```
#code-container  (position: relative; overflow-y: auto)
└── #canvas-host  (position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10)
    ├── canvas#draw-committed  (z-index 1; pointer-events: none)
    └── canvas#draw-active     (z-index 2; pointer-events: auto)
```

Because `#canvas-host` fills `#code-container` at 100% width and height and sits at `top:0; left:0`, and `#code-container` is `overflow-y: auto`, scrolling the code container also scrolls the canvas host — code and drawings scroll together natively with no JavaScript scroll sync.

### Canvas Sizing via ResizeObserver

```typescript
this.resizeObserver = new ResizeObserver(() => {
  this.resize();
});
this.resizeObserver.observe(this.scrollContainer);
```

`resize()` sets `canvas.width` and `canvas.height` to the `scrollContainer.scrollWidth × scrollHeight` (the full scrollable area, not just the viewport). This makes the entire document height drawable.

### `redrawCommitted()`

Clears and redraws the committed canvas from scratch on every mutation. The render loop:

```typescript
committedCtx.clearRect(0, 0, width, height);
committedCtx.save();
committedCtx.scale(zoomScale, zoomScale);

for (const obj of store.getAll()) {
  if (hiddenLayerIds.has(obj.layerId)) continue;
  if (editingIds.has(obj.id)) continue;  // hide TextObjects being edited in textarea
  renderObject(obj);
}

committedCtx.restore();
```

`renderObject()` dispatches by `obj.type`:
- **`"stroke"`**: Uses a `strokeCache: Map<string, StrokeRenderCache>` that stores pre-built `Path2D` objects. Cache miss triggers `buildStrokePath()` via `perfect-freehand`; subsequent redraws (e.g. after zoom) use the cached path.
- **`"shape"`**: Renders via `committedCtx` stroke commands (line, moveTo, bezierCurveTo for arrows, rect, ellipse).
- **`"text"`**: Renders via `fillText()` with word-wrap logic. The rendered height is measured and written back to `obj.height` so hit-testing in `textTool` and `selectionManager` uses an accurate bounding box.
- **`"image"`**: Looks up a loaded `HTMLImageElement` from an internal `imageCache: Map<string, HTMLImageElement>`. On first use, creates an `<img>` element, sets its `src` to `baseAssetUri + "/" + obj.assetPath`, and caches it. Draws via `drawImage()`.

### `renderSelectionOverlay()`

Clears and redraws the active canvas, rendering the current selection state on top of all committed objects. Called whenever the selection changes, a drag operation is in progress, or a lasso is being drawn. Because the active canvas is cleared each frame, there is no state accumulation.

### Stroke Path Cache Invalidation

The `strokeCache` is not automatically invalidated when objects are mutated (e.g. moved, resized, color-changed). The invalidation contract is:

- `selectionManager.onClearStrokeCache(id)` is wired to `engine.clearStrokeCache(id)`.
- `SelectionManager` calls this for every stroke in the selection set when a translate or resize operation is committed, forcing `redrawCommitted()` to recompute the path at the new coordinates.

---

## 7. Object Model

All drawable objects share a `BaseObject` interface and are unified under the `DrawObject` discriminated union:

```typescript
type DrawObject = StrokeObject | ShapeObject | TextObject | ImageObject;
```

| Type | Discriminant | Key Fields |
|---|---|---|
| `StrokeObject` | `type: "stroke"` | `tool: "pen"\|"highlighter"`, `color`, `baseWidth`, `points: {x,y,pressure}[]` |
| `ShapeObject` | `type: "shape"` | `shape: "line"\|"arrow"\|"rectangle"\|"ellipse"`, `color`, `strokeWidth`, `x,y,width,height` |
| `TextObject` | `type: "text"` | `content`, `color`, `fontSize`, `bold`, `x,y,width`, `height?` |
| `ImageObject` | `type: "image"` | `assetPath` (relative filename under assets/), `x,y,width,height` |

### ObjectStore

`ObjectStore` is the single in-memory source of truth for the webview session. It is not shared with the extension host — the host only receives a serialized `FileDrawingDocument` via the `documentChanged` message.

| Method | Description |
|---|---|
| `getAll()` | Returns `ReadonlyArray<DrawObject>` — tools must not mutate this directly |
| `getById(id)` | Linear scan; acceptable at current object counts |
| `snapshot()` | `JSON.parse(JSON.stringify(objects))` — deep clone for history snapshots |
| `add(obj)` | Append |
| `remove(ids)` | Filter out by ID Set |
| `replace(id, next)` | In-place replacement at index |
| `replaceWithMany(id, replacements)` | Used by pixel eraser to split one stroke into many |
| `replaceAll(objects)` | Used by undo/redo to restore a full snapshot |
| `clear()` | Used on document load |

### Coordinate Space

All `x`, `y`, `width`, `height`, and `points` values are stored in **document space** — pixels at zoom scale 1.0. No screen-space or viewport coordinates are ever persisted. At render time, a single `ctx.scale(zoomScale, zoomScale)` transform is applied before drawing all objects. Input coordinates from pointer events are converted by:

```typescript
clientToDocument(clientX, clientY): { x, y } {
  const rect = this.activeCanvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / this.zoomScale,
    y: (clientY - rect.top) / this.zoomScale,
  };
}
```

This means zoom has no effect on stored coordinates — zooming in/out at the same canvas location and then drawing produces identically-positioned objects in storage.

---

## 8. Layers

The layer system is managed by two parallel state containers:

1. **`activeLayers: Layer[]`** in `main.ts` — the authoritative layer list, serialized into `FileDrawingDocument.layers` on every save.
2. **`engine.hiddenLayerIds: Set<string>`** and **`selectionManager.hiddenLayerIds: Set<string>`** — fast membership lookup at render and selection time.

Every `DrawObject` has a `layerId: string` field. On `redrawCommitted()`, objects whose `layerId` is in `engine.hiddenLayerIds` are skipped entirely. On lasso completion in `selectionManager`, objects on hidden layers are never added to the selection set.

### Default Layer

A default layer with `id: "default"` is always present. If the loaded document has no layers array, `initCanvas()` synthesizes one. The invariant of at least one layer is enforced in the UI — the "＋ New" button is always available but there is no delete-layer operation.

### Layer Creation

```typescript
function createNewLayer(name: string): void {
  const newLayer: Layer = { id: randomUUID(), name, visible: true, order: activeLayers.length };
  activeLayers.push(newLayer);
  activeLayerId = newLayer.id;
  engine.activeLayerId = activeLayerId;
  createLayersPanel();
  triggerDocumentChanged();
}
```

New objects created after this point receive `layerId = engine.activeLayerId`.

### Visibility Toggle

`toggleLayerVisibility(id)` mutates the layer's `.visible` field, updates both `hiddenLayerIds` Sets, deselects any currently selected objects on that layer via `selectionManager.deselectObjectsOnLayer(id, store)`, repaints both canvases, and triggers a save.

---

## 9. Selection System

The selection system is split across three files with clearly separated responsibilities:

| File | Responsibility |
|---|---|
| `lassoTool.ts` | Pointer event routing only — delegates all geometry to `SelectionManager` |
| `selectionManager.ts` | Selection state, lasso geometry, bounding box, move/resize/delete/duplicate/color-change operations |
| `selectionHandle.ts` | Pure geometry utilities — no state, no DOM |
| `objectTransforms.ts` | Mutation functions that produce new object values for move and resize |

### Selection State

`SelectionManager` holds:
- `selectedIds: Set<string>` — current selection
- `lassoPoints: {x,y}[]` — live polygon being drawn
- Move drag state (`isDraggingMove`, `moveDragLastX/Y`, `moveBeforeSnapshot`)
- Resize drag state (`isDraggingResize`, `resizeHandleIndex`, `resizeDragStartX/Y`, `resizeStartBB`, `resizeBeforeSnapshot`)

### Lasso Hit Testing

On `pointerup` after a lasso gesture, `SelectionManager.completeLasso(store)` computes which objects fall inside the polygon:

- **Strokes**: `strokeIntersectsLasso(stroke.points, lassoPoints)` — true if any stroke point is inside the polygon.
- **Shapes, text boxes, images**: `bbIntersectsLasso(bb, lassoPoints)` — true if any corner of the bounding box is inside the polygon.
- `pointInPolygon` uses the standard ray-casting algorithm.

### Resize Handles

Handles are generated by `getHandles(bb: BoundingBox): Handle[]` in `selectionHandle.ts`. Eight handles are placed at corners and midpoints of the bounding box. They are only shown for non-stroke objects — strokes are move-only.

`hitTestHandle(point, handles)` finds which handle (if any) the pointer is touching. The hit radius is `HANDLE_RADIUS` (a constant).

On resize drag commit, `objectTransforms.ts` computes the new `x, y, width, height` for each selected object from the ratio of old-to-new bounding box dimensions.

### History Integration

Every destructive operation takes a snapshot before and after:

```typescript
const before = store.snapshot();
// ... mutation ...
history.pushAction({ before, after: store.snapshot() });
engine.onChanged?.();
```

`HistoryManager.pushAction` skips no-op actions using `areSnapshotsEqual()` — which checks array length, object IDs in order, and (for strokes) point count and color.

---

## 10. Zoom

Zoom state is stored in `activeZoomScale: number` in `main.ts` (range: `0.5` – `2.0`, step: `0.1`).

### CSS Variable

The code layer uses a CSS custom property:

```css
#code-container {
  font-size: calc(13px * var(--zoom-scale, 1.0));
}

.code-line {
  height: calc(20px * var(--zoom-scale, 1.0));
  line-height: calc(20px * var(--zoom-scale, 1.0));
}
```

When `changeZoom(delta)` runs:

```typescript
document.body.style.setProperty("--zoom-scale", activeZoomScale.toString());
engine.zoomScale = activeZoomScale;
engine.resize();
(engine as any).redrawCommitted();
engine.renderSelectionOverlay();
```

This causes the code DOM to reflow at the new font size, and all canvas objects to re-render scaled. Because objects are stored in document space and `ctx.scale(zoomScale, zoomScale)` is applied at render time, no object coordinates change on zoom.

### Viewport Center Preservation

`changeZoom()` preserves the visual center of the viewport across zoom transitions:

```typescript
const centerX = container.scrollLeft + container.clientWidth / 2;
const centerY = container.scrollTop + container.clientHeight / 2;
const docCenterX = centerX / oldScale;
const docCenterY = centerY / oldScale;

// ... apply new scale ...

container.scrollLeft = docCenterX * activeZoomScale - container.clientWidth / 2;
container.scrollTop  = docCenterY * activeZoomScale - container.clientHeight / 2;
```

### Scroll-Wheel Zoom

```typescript
document.addEventListener("wheel", (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    changeZoom(delta);
  }
}, { passive: false });
```

`passive: false` is required because the default browser scroll behaviour must be suppressed.

---

## 11. Persistence

### DrawStore (Extension Host)

`DrawStore` manages all filesystem access. The webview has no filesystem access.

**In-memory structure:**
```typescript
drawingsByFolder: Map<folderUriString, Map<relativeFilePath, FileDrawingDocument>>
```

**On `documentChanged` message:**
```
DrawStore.updateDrawing(uri, doc)
  → locate(uri)  // resolve workspace folder + relative path
  → update drawingsByFolder
  → scheduleSave(folder)  // 500ms debounced setTimeout
```

**Debounced save (`scheduleSave` → `persist`):**

```typescript
private scheduleSave(folder): void {
  const key = folder.uri.toString();
  clearTimeout(this.saveTimers.get(key));
  const timer = setTimeout(() => {
    this.saveTimers.delete(key);
    void this.persist(folder);
  }, 500);
  this.saveTimers.set(key, timer);
}
```

Each debounce timer is keyed by folder — drawings in different workspace folders do not interfere.

**`persist(folder)` flow:**
1. `vscode.workspace.fs.createDirectory(dirUri)` — ensures `.codenotes/drawings/` exists.
2. Serializes all `FileDrawingDocument` entries in the folder into a single `DrawingsFile` object.
3. `vscode.workspace.fs.writeFile(storeUri, bytes)` — atomic write.
4. On success: fires `onSaveSuccess?.()` → host forwards `saveSuccess` → webview dismisses toast.
5. On failure: fires `vscode.window.showErrorMessage(...)` AND `onSaveError?.(String(err))` → host forwards `saveFailed` → webview shows toast.

**`forceSave(uri)` — called on panel dispose:**
```typescript
clearTimeout(saveTimers.get(key));
saveTimers.delete(key);
await this.persist(folder);
```

The pending debounce timer is cancelled and an immediate synchronous persist runs. This guarantees that the last few hundred milliseconds of drawing before closing a panel are not lost.

### Storage Format on Disk

```
.codenotes/drawings/drawings.json
{
  "version": 1,
  "files": {
    "src/index.ts": { /* FileDrawingDocument */ }
  }
}
```

All file paths use POSIX separators regardless of host OS. `locate(uri)` uses:
```typescript
path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/")
```

### WebviewToHost Save Trigger

The webview debounces its own save trigger (`triggerDocumentChanged`, 500ms) before sending `documentChanged`. This double-debounce means total latency before a disk write is up to 1000ms in the common case. During high-frequency drawing (many `pointermove` events), the webview timer resets on each tool `onChanged` call, so rapid strokes trigger a single network round-trip.

---

## 12. Image Import Pipeline

Images flow through a well-defined pipeline that keeps the webview isolated from filesystem access:

```
User action (paste / drag-drop / file picker)
       ↓
handleImageFile(file, dropX?, dropY?)   [webview: main.ts]
  → FileReader reads file as dataURL
  → HTMLImageElement measures dimensions
  → If width or height > 2000px: downscale with a temporary <canvas> + drawImage()
  → Determine MIME type → extension (png/jpg/gif/webp)
  → Compute display dimensions: min(350px, naturalWidth), proportional height
  → Compute canvas position: centered in viewport, or at drop coordinates
  → vscode.postMessage({ type: "requestImageImport", dataUrl, suggestedExt, width, height, x, y })
       ↓
DrawCustomEditorProvider.handleImageImport()   [extension host]
  → Parse base64 from dataUrl
  → vscode.workspace.fs.createDirectory(assetsDir)
  → Generate filename: randomUUID() + "." + suggestedExt
  → vscode.workspace.fs.writeFile(assetFileUri, dataBuffer)
  → Compute webviewUri = webview.asWebviewUri(assetFileUri).toString()
  → webview.postMessage({ type: "imageImported", assetPath: filename, webviewUri, width, height, x, y })
       ↓
handleImageImported(msg)   [webview: main.ts]
  → ObjectStore.add(ImageObject with assetPath = filename)
  → HistoryManager.pushAction(...)
  → selectTool("select")
  → selectionManager.selectObject(newImage.id)
  → redrawCommitted() + renderSelectionOverlay()
  → engine.onChanged?.()   // triggers save
```

**Why the dataUrl round-trip?**
The webview cannot write files. The extension host cannot access clipboard data. The dataUrl is the only encoding that can cross the message-passing boundary.

**Why is `assetPath` just the filename, not a full path?**
`ImageObject.assetPath` stores only the filename (e.g. `"a3f2...png"`). The full path is reconstructed at render time as `baseAssetUri + "/" + assetPath`, where `baseAssetUri` is a webview URI for `.codenotes/drawings/assets/` computed by the host during `sendInit()`.

---

## 13. Content Security Policy

The webview HTML is generated by `getWebviewHtml()` in `drawCustomEditorProvider.ts`. A cryptographically random nonce is generated per-open via `getNonce()`:

```typescript
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

The nonce is embedded in the CSP header and the `<script>` tag:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src 'nonce-${nonce}';
               style-src 'unsafe-inline';
               img-src ${webview.cspSource} data:;
               font-src 'none';
               connect-src 'none';
               frame-src 'none';
               object-src 'none';
               worker-src 'none';">
```

```html
<script nonce="${nonce}" src="${scriptUri}"></script>
```

`scriptUri` is computed via `webview.asWebviewUri(...)` pointing to `out/webview/main.js`. Only this exact URI with this exact nonce will execute. Any injected script — including browser extensions that attempt to inject into webviews — is blocked.

**`img-src ${webview.cspSource} data:`** allows:
- `webview.cspSource`: Local workspace files accessed via `vscode-resource:` scheme (image assets).
- `data:`: Needed for any inline base64 images (not currently used by the extension, but required for some `<canvas>.toDataURL()` output paths during development).

**`style-src 'unsafe-inline'`**: All styles are inlined in the `<style>` block inside the HTML returned by `getWebviewHtml()`. No external stylesheets are loaded. The `unsafe-inline` allowance is for these inline styles only.

---

## 14. Hover Notes Module

The hover notes module is architecturally independent of the draw module. It is briefly described here for completeness.

### NoteStore

Manages `.codenotes/notes.json` per workspace folder using the same `Map<folderUriString, CodeNote[]>` pattern as `DrawStore`. Save is debounced at 300ms (slightly more aggressive than draw's 500ms, since text notes are smaller). Save failures show an error message but do not surface a webview toast (there is no webview involved).

### Content-Based Anchoring (`anchor.ts`)

`resolveNoteLine(document, note, searchWindow)`:
1. Check `note.line` — if `document.lineAt(note.line).text.trim() === note.anchorText`, return immediately (O(1) fast path).
2. Otherwise, search outward: line `lastKnown + 1`, `lastKnown - 1`, `lastKnown + 2`, `lastKnown - 2`, ... up to `searchWindow`.
3. First match wins. Empty/whitespace-only anchor text is never matched.
4. If no match is found, return `{ line: null, moved: true }` — the note is orphaned.

### DecorationManager

Listens to `onDidChangeActiveTextEditor`, `onDidSaveTextDocument`, `onDidOpenTextDocument`, and `store.onDidChange`. On each event, calls `reanchorAndRender(editor)`:

1. For every note on the document, run `resolveNoteLine`.
2. If the note moved or orphaned state changed, call `store.updateNotePosition(id, line, anchorText, orphaned)` (which schedules a save).
3. Apply `noteDecoration` to all anchored lines and `orphanedDecoration` to all orphaned lines.

---

## 15. Design Decisions and Their Rationale

### Custom Editor, Not a DOM Overlay

VS Code's public extension API provides no mechanism to inject arbitrary DOM content into the Monaco editor view. Attempts to do so (patching `workbench.desktop.main.js`, using custom CSS loaders) are unsupported, break on every VS Code update, and trigger integrity warnings. The Custom Editor API is the only fully-supported approach. The tradeoff is that Draw Mode opens as a separate tab with a read-only code view — not a literal transparent layer over live typing. This was an explicit, documented product decision.

### `retainContextWhenHidden: true`

The webview context is preserved when the tab is not visible. This trades memory for correctness: without it, switching tabs clears the undo stack, selection state, and all in-memory tool state. The undo stack would reset every time the user switched to a text editor and back. The cost is that the Chromium process holds the webview alive while it's hidden.

### Snapshot-Based Undo (Not Command Pattern)

History is stored as `{ before: DrawObject[], after: DrawObject[] }` pairs — full snapshots of the object array, not reverse-command functions. This is simpler to implement and reason about, especially for operations like pixel erase that transform one stroke into multiple sub-strokes. The cost is memory: each history entry holds two deep copies of the entire object array. At typical object counts (< a few hundred objects), this is not a concern.

### `areSnapshotsEqual` for No-Op Detection

`HistoryManager.pushAction` skips actions where `before` and `after` are equal. The equality check is cheap: compare array lengths, then IDs in order, then (for strokes) point count and color. This prevents the undo stack from filling with phantom no-ops from hover/preview operations that touch the store but make no net change.

### Plain JSON on Disk (Not SQLite/IndexedDB)

`drawings.json` is a plain JSON file. This means:
- It is human-readable and debuggable with any text editor.
- It is diffable — meaningful changes appear in git diffs.
- It requires no database driver.
- It has a simple, predictable failure mode (file corruption = one file to delete and start over).

The downside is that every save rewrites the entire JSON file for all files in the workspace folder. At the current expected scale (< a few hundred objects per file, < tens of annotated files), this is not a bottleneck.

### Images Stored as Separate Asset Files

Images are stored as individual files under `.codenotes/drawings/assets/`, referenced by UUID filename. Base64-inlining images into `drawings.json` was explicitly rejected because:
- A single 2000×2000px PNG embedded as base64 adds ~10 MB to the JSON file.
- Every subsequent save and load — even for a single new stroke — would read and write that entire 10 MB blob.
- Git diffs of `drawings.json` would become unreadable.

### No WebView Filesystem Access

The webview never reads or writes files directly. This is not merely a security preference — the VS Code webview runtime provides no filesystem API. All I/O is routed through the extension host via message passing. This architectural boundary means that if the filesystem access logic ever needs to change (e.g. to support remote workspaces), only `drawCustomEditorProvider.ts` and `drawStore.ts` need to change. The webview is unaffected.

### `supportsMultipleEditorsPerDocument: false`

Only one Draw Mode panel per file is allowed at a time. Allowing multiple panels would require keeping their `ObjectStore` instances in sync, which adds significant complexity for minimal practical benefit.

### Coordinate Space: Document-Relative, Not Screen-Relative

Storing coordinates in screen pixels would mean that changing the zoom level invalidates all stored positions — every coordinate would need to be recalculated and re-saved on every zoom change. Document-space coordinates (pixels at zoom=1) are zoom-invariant. The single `ctx.scale(zoomScale, zoomScale)` at render time applies the zoom uniformly to all objects without touching stored values.
