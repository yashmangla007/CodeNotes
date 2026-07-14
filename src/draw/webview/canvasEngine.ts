// ---------------------------------------------------------------------------
// canvasEngine.ts — Two-canvas drawing surface (Phase 5 refactor)
//
// Phase 5 changes:
//   - Object store: internal strokes[] replaced by an ObjectStore instance
//     that holds any DrawObject (stroke, shape, text, image).
//   - Rendering: redrawCommitted() now dispatches per object type via
//     renderObject(). Adding Phase 6+ types = add one switch case.
//   - History: HistoryAction now uses DrawObject[] snapshots (not FinishedStroke[]).
//   - Selection overlay: renderSelectionOverlay() renders onto the active
//     canvas (cleared each frame) so lasso/handles appear above drawings.
//
// Layer stack inside #canvas-host (positioned absolutely over #code-container):
//
//   canvas#draw-committed  (z-index 1) 
//     Finished objects only. Redrawn only when objects are added/removed.
//
//   canvas#draw-active     (z-index 2)
//     In-progress stroke / eraser preview / lasso outline / selection handles.
//     Cleared on every frame / gesture tick.
// ---------------------------------------------------------------------------

import { buildStrokePath } from "./penTool";
import type { InputPoint } from "./penTool";
import type { DrawObject, StrokeObject, ShapeObject, TextObject, ImageObject, FileDrawingDocument } from "../drawTypes";
import { randomUUID } from "./uuid";
import { HistoryManager } from "./historyManager";
import { ObjectStore } from "./objectStore";
import type { SelectionManager } from "./selectionManager";

/** Base stroke size in canvas pixels at zoom=1 */
const BASE_STROKE_SIZE = 4;

/**
 * Internal cache entry for a committed stroke — keeps the pre-built Path2D
 * so we don't recompute it on every redraw.
 */
interface StrokeRenderCache {
  id: string;
  path: Path2D;
  color: string;
}

export class CanvasEngine {
  /** The canvas for committed (finished) objects */
  private readonly committedCanvas: HTMLCanvasElement;
  private readonly committedCtx: CanvasRenderingContext2D;

  /** The canvas for active overlays (in-progress stroke, eraser, lasso, handles) */
  private readonly activeCanvas: HTMLCanvasElement;
  private readonly activeCtx: CanvasRenderingContext2D;

  /** ResizeObserver watches the scroll container to keep canvases sized */
  private resizeObserver: ResizeObserver | null = null;
  private isRedrawing = false;

  /** Callback triggered when objects are mutated (drives debounced save) */
  public onChanged: (() => void) | null = null;

  public readonly hiddenLayerIds = new Set<string>();
  public activeLayerId = "default";
  public zoomScale = 1.0;

  clientToDocument(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.activeCanvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.zoomScale,
      y: (clientY - rect.top) / this.zoomScale,
    };
  }

  /** Callback triggered when undo/redo stack state changes */
  public onHistoryStateChange: (() => void) | null = null;

  /** History stack */
  private readonly history = new HistoryManager(() => {
    this.onHistoryStateChange?.();
  });

  /** Unified object store */
  private readonly store = new ObjectStore();

  /**
   * Path2D cache for stroke objects — avoids recomputing perfect-freehand
   * geometry on every redraw after resize.
   */
  private strokeCache = new Map<string, StrokeRenderCache>();

  /** Snapshot before starting an erase gesture */
  private beforeEraseSnapshot: DrawObject[] | null = null;

  /** Optional reference to the SelectionManager for overlay rendering */
  private selectionManager: SelectionManager | null = null;

  private baseAssetUri: string = "";

  constructor(private readonly scrollContainer: HTMLElement) {
    // Create canvas host — absolutely positioned, same top-left as scroll container
    const host = document.createElement("div");
    host.id = "canvas-host";
    host.style.cssText = [
      "position: absolute",
      "top: 0",
      "left: 0",
      "width: 100%",
      "height: 100%",
      "pointer-events: none",
      "z-index: 10",
    ].join(";");

    // Committed canvas (bottom layer)
    this.committedCanvas = this.makeCanvas("draw-committed", 1);
    this.committedCtx = this.committedCanvas.getContext("2d")!;

    // Active canvas (top layer — receives pointer events)
    this.activeCanvas = this.makeCanvas("draw-active", 2);
    this.activeCanvas.style.pointerEvents = "auto";
    this.activeCanvas.style.cursor = "crosshair";
    this.activeCtx = this.activeCanvas.getContext("2d")!;

    host.appendChild(this.committedCanvas);
    host.appendChild(this.activeCanvas);

    scrollContainer.style.position = "relative";
    scrollContainer.appendChild(host);

    this.initResizeObserver();
  }

  // ---- Public accessors ---------------------------------------------------

  public readonly editingIds = new Set<string>();

  get scrollContainerElement(): HTMLElement {
    return this.scrollContainer;
  }

  get activeCanvasElement(): HTMLCanvasElement {
    return this.activeCanvas;
  }

  /** Provide the selection manager so this engine can render its overlay. */
  setSelectionManager(sm: SelectionManager): void {
    this.selectionManager = sm;
    // When selection changes, re-render the overlay
    sm.onSelectionChange = () => {
      this.renderSelectionOverlay();
    };
  }

  /** Read-only access to the object store (for tools that need it). */
  getStore(): ObjectStore {
    return this.store;
  }

  /** Read-only access to the history manager (for LassoTool). */
  getHistory(): HistoryManager {
    return this.history;
  }

  // ---- Stroke rendering (pen tool interface) ------------------------------

  /**
   * Render the in-progress stroke on the active canvas.
   * Called on every pointermove. Clears active canvas first.
   */
  renderActiveStroke(
    points: InputPoint[],
    color: string,
    width: number,
    last: boolean
  ): void {
    const ctx = this.activeCtx;
    const { width: canvWidth, height: canvHeight } = this.activeCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvWidth, canvHeight);

    if (points.length === 0) return;

    ctx.save();
    ctx.scale(this.zoomScale, this.zoomScale);

    const path = buildStrokePath(points, width, last);
    ctx.fillStyle = color;
    ctx.fill(path);

    ctx.restore();
  }

  clearActiveCanvas(): void {
    const { width, height } = this.activeCanvas;
    this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.activeCtx.clearRect(0, 0, width, height);
  }

  /** Re-render the selection overlay (lasso/BB/handles) on the active canvas. */
  renderSelectionOverlay(): void {
    const { width, height } = this.activeCanvas;
    this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.activeCtx.clearRect(0, 0, width, height);
    this.activeCtx.save();
    this.activeCtx.scale(this.zoomScale, this.zoomScale);
    this.selectionManager?.renderOverlay(this.activeCtx, this.store);
    this.activeCtx.restore();
  }

  clearStrokeCache(id: string): void {
    this.strokeCache.delete(id);
  }

  /**
   * Commit a finished stroke to the committed canvas and the object store.
   */
  commitStroke(points: InputPoint[], color: string, width: number): void {
    if (points.length === 0) return;

    const path = buildStrokePath(points, width, true);

    const now = new Date().toISOString();
    const newStroke: StrokeObject = {
      id: randomUUID(),
      layerId: this.activeLayerId,
      createdAt: now,
      updatedAt: now,
      opacity: 1,
      type: "stroke",
      tool: "pen",
      color,
      baseWidth: width,
      points: points.map((p) => ({
        x: p.x,
        y: p.y,
        pressure: p.pressure ?? 0.5,
      })),
    };

    const before = this.store.snapshot();

    // Cache the path, add to store
    this.strokeCache.set(newStroke.id, { id: newStroke.id, path, color });

    this.store.add(newStroke);
    this.clearActiveCanvas();

    this.history.pushAction({ before, after: this.store.snapshot() });
    this.onChanged?.();
    this.redrawCommitted();
  }

  // ---- Erase operations (eraser tool interface) ---------------------------

  startEraseGesture(): void {
    this.beforeEraseSnapshot = this.store.snapshot();
  }

  eraseAlongSegment(
    a: { x: number; y: number },
    b: { x: number; y: number },
    radius: number,
    mode: "stroke" | "pixel"
  ): void {
    if (!this.beforeEraseSnapshot) return;

    let changed = false;
    const objects = [...this.store.getAll()];

    if (mode === "stroke") {
      // ---- Stroke eraser: remove any object whose geometry touches the eraser ----
      const toRemove: string[] = [];
      for (const obj of objects) {
        if (this.hiddenLayerIds.has(obj.layerId)) continue;

        if (obj.type === "stroke") {
          // Point-to-segment test for each control point
          for (const p of obj.points) {
            if (distanceToSegment(p, a, b) < radius) {
              toRemove.push(obj.id);
              changed = true;
              break;
            }
          }
        } else if (obj.type === "shape") {
          // Line / arrow: check the drawn line segment
          if (obj.shape === "line" || obj.shape === "arrow") {
            const p1 = { x: obj.x, y: obj.y };
            const p2 = { x: obj.x + obj.width, y: obj.y + obj.height };
            if (circleSweptSegmentIntersectsSegment(a, b, radius, p1, p2)) {
              toRemove.push(obj.id);
              changed = true;
            }
          } else {
            // Rectangle / ellipse: AABB vs eraser circle
            if (circleIntersectsRect(a, b, radius, obj.x, obj.y, obj.width, obj.height)) {
              toRemove.push(obj.id);
              changed = true;
            }
          }
        } else if (obj.type === "text" || obj.type === "image") {
          const h = (obj as any).height ?? 0;
          if (circleIntersectsRect(a, b, radius, obj.x, obj.y, obj.width, h)) {
            toRemove.push(obj.id);
            changed = true;
          }
        }
      }
      if (changed) {
        this.store.remove(toRemove);
        for (const id of toRemove) this.strokeCache.delete(id);
      }
    } else {
      // ---- Pixel eraser: split freehand strokes; whole-delete other types ----

      // Pass 1: collect non-stroke objects to remove
      const toRemove: string[] = [];
      for (const obj of objects) {
        if (this.hiddenLayerIds.has(obj.layerId)) continue;
        if (obj.type === "stroke") continue; // handled in pass 2

        if (obj.type === "shape") {
          if (obj.shape === "line" || obj.shape === "arrow") {
            const p1 = { x: obj.x, y: obj.y };
            const p2 = { x: obj.x + obj.width, y: obj.y + obj.height };
            if (circleSweptSegmentIntersectsSegment(a, b, radius, p1, p2)) {
              toRemove.push(obj.id);
            }
          } else {
            if (circleIntersectsRect(a, b, radius, obj.x, obj.y, obj.width, obj.height)) {
              toRemove.push(obj.id);
            }
          }
        } else if (obj.type === "text" || obj.type === "image") {
          const h = (obj as any).height ?? 0;
          if (circleIntersectsRect(a, b, radius, obj.x, obj.y, obj.width, h)) {
            toRemove.push(obj.id);
          }
        }
      }
      if (toRemove.length > 0) {
        this.store.remove(toRemove);
        changed = true;
      }

      // Pass 2: pixel-split freehand strokes
      for (const obj of objects) {
        if (this.hiddenLayerIds.has(obj.layerId)) continue;
        if (obj.type !== "stroke") continue;
        const strokeObj = obj as StrokeObject;
        let touched = false;
        let currentSegment: { x: number; y: number; pressure: number }[] = [];
        const replacements: StrokeObject[] = [];

        for (const p of strokeObj.points) {
          const dist = distanceToSegment(p, a, b);
          if (dist >= radius) {
            currentSegment.push(p);
          } else {
            touched = true;
            if (currentSegment.length > 0) {
              replacements.push(makeSubStroke(strokeObj, currentSegment));
              currentSegment = [];
            }
          }
        }
        if (currentSegment.length > 0) {
          if (touched) {
            replacements.push(makeSubStroke(strokeObj, currentSegment));
          } else {
            // Untouched — keep original
            continue;
          }
        }

        if (touched) {
          changed = true;
          this.strokeCache.delete(strokeObj.id);
          this.store.replaceWithMany(strokeObj.id, replacements);
          for (const r of replacements) {
            const path = buildStrokePath(r.points, strokeObj.baseWidth, true);
            this.strokeCache.set(r.id, { id: r.id, path, color: r.color });
          }
        }
      }
    }

    if (changed) {
      this.redrawCommitted();
    }
  }

  commitEraseGesture(): void {
    if (!this.beforeEraseSnapshot) return;

    this.history.pushAction({
      before: this.beforeEraseSnapshot,
      after: this.store.snapshot(),
    });

    this.beforeEraseSnapshot = null;
    this.onChanged?.();
  }

  // ---- Undo / Redo interface ---------------------------------------------

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  undo(): void {
    const action = this.history.undo();
    if (action) {
      this.store.replaceAll(JSON.parse(JSON.stringify(action.before)));
      this.rebuildStrokeCache();
      this.redrawCommitted();
      this.renderSelectionOverlay();
      this.onChanged?.();
    }
  }

  redo(): void {
    const action = this.history.redo();
    if (action) {
      this.store.replaceAll(JSON.parse(JSON.stringify(action.after)));
      this.rebuildStrokeCache();
      this.redrawCommitted();
      this.renderSelectionOverlay();
      this.onChanged?.();
    }
  }

  // ---- Document Loading --------------------------------------------------

  loadDocument(doc: FileDrawingDocument, baseAssetUri?: string): void {
    this.store.clear();
    this.strokeCache.clear();
    if (baseAssetUri !== undefined) {
      this.baseAssetUri = baseAssetUri;
    }

    for (const obj of doc.objects) {
      this.store.add(obj);
      if (obj.type === "stroke") {
        const path = buildStrokePath(obj.points, obj.baseWidth, true);
        this.strokeCache.set(obj.id, { id: obj.id, path, color: obj.color });
      }
    }

    this.history.clear();
    this.redrawCommitted();
  }

  /** Return all DrawObjects for persistence (Phase 3 contract). */
  getAllObjects(): DrawObject[] {
    return this.store.snapshot();
  }

  // ---- Resize canvas -----------------------------------------------------

  resize(): void {
    const scrollWidth = this.scrollContainer.scrollWidth;
    const scrollHeight = this.scrollContainer.scrollHeight;

    const didChange =
      this.committedCanvas.width !== scrollWidth ||
      this.committedCanvas.height !== scrollHeight;

    if (!didChange) return;

    this.committedCanvas.width = scrollWidth;
    this.committedCanvas.height = scrollHeight;
    this.activeCanvas.width = scrollWidth;
    this.activeCanvas.height = scrollHeight;

    const host = this.committedCanvas.parentElement as HTMLElement;
    host.style.width = `${scrollWidth}px`;
    host.style.height = `${scrollHeight}px`;

    this.redrawCommitted();
    this.renderSelectionOverlay();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.committedCanvas.remove();
    this.activeCanvas.remove();
    document.getElementById("canvas-host")?.remove();
  }

  // ---- Private helpers ---------------------------------------------------

  private makeCanvas(id: string, zIndex: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.style.cssText = [
      "position: absolute",
      "top: 0",
      "left: 0",
      `z-index: ${zIndex}`,
      "touch-action: none",
    ].join(";");
    return canvas;
  }

  private initResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => this.resize());
    });
    this.resizeObserver.observe(this.scrollContainer);
    const codeContent = this.scrollContainer.firstElementChild;
    if (codeContent) {
      this.resizeObserver.observe(codeContent);
    }
    this.resize();
  }

  /** Redraw all committed objects (called after canvas resize or object mutation). */
  private redrawCommitted(): void {
    if (this.isRedrawing) return;
    this.isRedrawing = true;

    try {
      const ctx = this.committedCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.committedCanvas.width, this.committedCanvas.height);

      ctx.save();
      ctx.scale(this.zoomScale, this.zoomScale);

      for (const obj of this.store.getAll()) {
        if (this.hiddenLayerIds.has(obj.layerId)) {
          continue;
        }
        renderObject(ctx, obj, this.strokeCache, this.editingIds, this.baseAssetUri, () => this.redrawCommitted());
      }

      ctx.restore();
    } finally {
      this.isRedrawing = false;
    }
  }

  /**
   * Rebuild the Path2D cache for all stroke objects.
   * Called after undo/redo when the store is replaced wholesale.
   */
  private rebuildStrokeCache(): void {
    this.strokeCache.clear();
    for (const obj of this.store.getAll()) {
      if (obj.type === "stroke") {
        const path = buildStrokePath(obj.points, obj.baseWidth, true);
        this.strokeCache.set(obj.id, { id: obj.id, path, color: obj.color });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-type rendering dispatch
// Adding a new type in Phase 6/7 = add one case here
// ---------------------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement | "failed">();

function renderObject(
  ctx: CanvasRenderingContext2D,
  obj: DrawObject,
  strokeCache: Map<string, StrokeRenderCache>,
  editingIds: Set<string>,
  baseAssetUri: string,
  triggerRedraw: () => void
): void {
  switch (obj.type) {
    case "stroke":
      renderStroke(ctx, obj, strokeCache);
      break;
    case "shape":
      renderShape(ctx, obj);
      break;
    case "text":
      if (!editingIds.has(obj.id)) {
        renderText(ctx, obj);
      }
      break;
    case "image":
      renderImage(ctx, obj, baseAssetUri, triggerRedraw);
      break;
  }
}

function resolveAssetSrc(assetPath: string, baseAssetUri: string): string {
  if (
    assetPath.startsWith("http://") ||
    assetPath.startsWith("https://") ||
    assetPath.startsWith("vscode-webview-resource:") ||
    assetPath.startsWith("vscode-resource:")
  ) {
    return assetPath;
  }
  let filename = assetPath;
  if (filename.startsWith("assets/")) {
    filename = filename.slice("assets/".length);
  }
  if (filename.startsWith("/")) {
    filename = filename.slice(1);
  }
  if (!baseAssetUri) {
    return filename;
  }
  const base = baseAssetUri.endsWith("/") ? baseAssetUri : baseAssetUri + "/";
  return base + filename;
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, obj: ImageObject, text: string): void {
  ctx.save();
  ctx.fillStyle = "rgba(45, 45, 45, 0.8)";
  ctx.strokeStyle = "rgba(100, 160, 255, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(obj.x, obj.y, obj.width, obj.height);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#858585";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, obj.x + obj.width / 2, obj.y + obj.height / 2);
  ctx.restore();
}

function renderImage(
  ctx: CanvasRenderingContext2D,
  obj: ImageObject,
  baseAssetUri: string,
  triggerRedraw: () => void
): void {
  const cached = imageCache.get(obj.assetPath);
  if (cached === "failed") {
    drawPlaceholder(ctx, obj, "⚠️ Image error");
    return;
  }
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) {
      ctx.drawImage(cached, obj.x, obj.y, obj.width, obj.height);
    } else {
      drawPlaceholder(ctx, obj, "⏳ Loading...");
    }
    return;
  }

  // Start loading
  const img = new Image();
  const src = resolveAssetSrc(obj.assetPath, baseAssetUri);
  img.onload = () => {
    requestAnimationFrame(() => triggerRedraw());
  };
  img.onerror = () => {
    imageCache.set(obj.assetPath, "failed");
    requestAnimationFrame(() => triggerRedraw());
  };
  img.src = src;
  imageCache.set(obj.assetPath, img);
  drawPlaceholder(ctx, obj, "⏳ Loading...");
}

function renderShape(ctx: CanvasRenderingContext2D, shapeObj: ShapeObject): void {
  ctx.save();
  ctx.strokeStyle = shapeObj.color;
  ctx.lineWidth = shapeObj.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const { shape, x, y, width, height } = shapeObj;

  switch (shape) {
    case "line":
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      ctx.stroke();
      break;

    case "arrow":
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      ctx.stroke();
      drawArrowhead(ctx, x, y, x + width, y + height, shapeObj.strokeWidth);
      break;

    case "rectangle":
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.stroke();
      break;

    case "ellipse":
      ctx.beginPath();
      const rx = Math.abs(width) / 2;
      const ry = Math.abs(height) / 2;
      const cx = x + width / 2;
      const cy = y + height / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }

  ctx.restore();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  strokeWidth: number
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = Math.max(10, 8 + strokeWidth * 2);
  const arrowAngle = Math.PI / 6; // 30 degrees

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - arrowAngle),
    toY - headLength * Math.sin(angle - arrowAngle)
  );
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle + arrowAngle),
    toY - headLength * Math.sin(angle + arrowAngle)
  );
  ctx.stroke();
}

function renderText(ctx: CanvasRenderingContext2D, textObj: TextObject): void {
  ctx.save();
  ctx.font = `${textObj.bold ? "bold " : ""}${textObj.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.fillStyle = textObj.color;
  ctx.textBaseline = "top";

  const lines = wrapText(ctx, textObj.content, textObj.width);
  const lineHeight = textObj.fontSize * 1.2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], textObj.x, textObj.y + i * lineHeight);
  }

  const computedHeight = lines.length * lineHeight;
  if (textObj.height !== computedHeight) {
    // Save-effect to align bounds dynamically
    textObj.height = computedHeight;
  }

  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Explicitly support newlines
    if (word.includes("\n")) {
      const subWords = word.split("\n");
      for (let j = 0; j < subWords.length; j++) {
        const testLine = currentLine ? currentLine + " " + subWords[j] : subWords[j];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = subWords[j];
        } else {
          currentLine = testLine;
        }
        if (j < subWords.length - 1) {
          lines.push(currentLine);
          currentLine = "";
        }
      }
      continue;
    }

    const testLine = currentLine ? currentLine + " " + word : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeObject,
  cache: Map<string, StrokeRenderCache>
): void {
  let entry = cache.get(stroke.id);
  if (!entry) {
    // Build and cache on demand (shouldn't normally be needed but guards against gaps)
    const path = buildStrokePath(stroke.points, stroke.baseWidth, true);
    entry = { id: stroke.id, path, color: stroke.color };
    cache.set(stroke.id, entry);
  }
  ctx.fillStyle = entry.color;
  ctx.fill(entry.path);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function makeSubStroke(
  original: StrokeObject,
  points: { x: number; y: number; pressure: number }[]
): StrokeObject {
  return {
    id: randomUUID(),
    layerId: original.layerId,
    createdAt: original.createdAt,
    updatedAt: new Date().toISOString(),
    opacity: original.opacity,
    type: "stroke",
    tool: original.tool,
    color: original.color,
    baseWidth: original.baseWidth,
    points,
  };
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const closestX = a.x + clampedT * dx;
  const closestY = a.y + clampedT * dy;
  return Math.hypot(p.x - closestX, p.y - closestY);
}

/**
 * Returns true if the eraser circle (sweeping along the eraser segment a→b)
 * intersects the object's line segment p1→p2.
 *
 * The check is: the minimum distance from any point on p1→p2 to the eraser
 * segment a→b is less than radius.  We test both endpoints of p1→p2 and the
 * four closest-point combinations, which is sufficient for straight shapes.
 */
function circleSweptSegmentIntersectsSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): boolean {
  // Distance from each object-segment endpoint to the eraser sweep segment
  if (distanceToSegment(p1, a, b) < radius) return true;
  if (distanceToSegment(p2, a, b) < radius) return true;
  // Distance from each eraser-segment endpoint to the object segment
  if (distanceToSegment(a, p1, p2) < radius) return true;
  if (distanceToSegment(b, p1, p2) < radius) return true;
  return false;
}

/**
 * Returns true if the eraser circle (radius, sweeping a→b) intersects the
 * axis-aligned bounding box [rx, ry, rw, rh].
 *
 * We expand the rect by `radius` on all sides and check whether the eraser
 * segment passes through that expanded region — a fast, conservative test that
 * avoids false negatives on narrow objects.
 */
function circleIntersectsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  // Expand rect by radius (Minkowski sum) and do segment vs expanded-AABB
  const ex = rx - radius;
  const ey = ry - radius;
  const ew = rw + radius * 2;
  const eh = rh + radius * 2;

  // Check whether either eraser endpoint is inside the expanded rect
  function inRect(p: { x: number; y: number }): boolean {
    return p.x >= ex && p.x <= ex + ew && p.y >= ey && p.y <= ey + eh;
  }
  if (inRect(a) || inRect(b)) return true;

  // Also check if the eraser segment crosses any of the 4 sides of the original rect
  // (original rect, not expanded, to avoid false positives for large radius)
  const corners: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
    [{ x: rx, y: ry }, { x: rx + rw, y: ry }], // top
    [{ x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }], // right
    [{ x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }], // bottom
    [{ x: rx, y: ry + rh }, { x: rx, y: ry }], // left
  ];
  for (const [c1, c2] of corners) {
    if (distanceToSegment(c1, a, b) < radius) return true;
    if (distanceToSegment(c2, a, b) < radius) return true;
    if (distanceToSegment(a, c1, c2) < radius) return true;
    if (distanceToSegment(b, c1, c2) < radius) return true;
  }
  return false;
}
