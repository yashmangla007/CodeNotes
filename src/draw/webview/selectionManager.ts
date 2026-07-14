// ---------------------------------------------------------------------------
// selectionManager.ts — Lasso selection, bounding-box display, and
//                        move / resize / delete / duplicate operations
//
// Architecture:
//   - SelectionManager owns selected IDs and the current lasso path.
//   - All geometry helpers live in selectionHandle.ts.
//   - All object transforms live in objectTransforms.ts.
//   - History snapshots are taken before/after each destructive operation.
//   - Rendering (lasso preview + bounding box + handles) is done on the
//     shared active canvas (cleared between frames by the render loop).
//
// Per the Phase 5 plan:
//   - Resize handles are shown ONLY for non-stroke objects.
//   - Strokes show a move cursor + drag only.
// ---------------------------------------------------------------------------

import type { DrawObject } from "../drawTypes";
import type { ObjectStore } from "./objectStore";
import type { HistoryManager } from "./historyManager";
import { translateObject } from "./objectTransforms";
import {
  objectsBoundingBox,
  getHandles,
  hitTestHandle,
  HANDLE_RADIUS,
  strokeIntersectsLasso,
  bbIntersectsLasso,
  pointInPolygon,
  type BoundingBox,
  type Handle,
} from "./selectionHandle";
import { randomUUID } from "./uuid";

// Pixel padding around the bounding box when drawing the selection outline
const BB_PADDING = 6;
// Dash pattern for the bounding box outline
const BB_DASH = [6, 4];

export class SelectionManager {
  // ---- Selection state ----------------------------------------------------

  private selectedIds = new Set<string>();
  public readonly hiddenLayerIds = new Set<string>();

  // ---- Lasso state (while drawing the lasso polygon) ----------------------

  private lassoPoints: { x: number; y: number }[] = [];
  private isDrawingLasso = false;

  // ---- Move drag state ----------------------------------------------------

  private isDraggingMove = false;
  private moveDragLastX = 0;
  private moveDragLastY = 0;
  /** Snapshot taken at the start of a move gesture (for history) */
  private moveBeforeSnapshot: DrawObject[] | null = null;

  // ---- Resize drag state --------------------------------------------------

  private isDraggingResize = false;
  private resizeHandleIndex = -1;
  private resizeDragStartX = 0;
  private resizeDragStartY = 0;
  private resizeStartBB: BoundingBox | null = null;
  private resizeBeforeSnapshot: DrawObject[] | null = null;

  // ---- Public callbacks ---------------------------------------------------

  /** Called when the selection set changes so the tool can update cursors */
  public onSelectionChange: (() => void) | null = null;
  /** Callback to clear cached rendering paths for a stroke (to force redraw on translate/scale) */
  public onClearStrokeCache: ((id: string) => void) | null = null;

  // =========================================================================
  // Lasso drawing
  // =========================================================================

  startLasso(): void {
    this.lassoPoints = [];
    this.isDrawingLasso = true;
  }

  updateLasso(x: number, y: number): void {
    if (!this.isDrawingLasso) return;
    this.lassoPoints.push({ x, y });
  }

  /**
   * Finish drawing the lasso: hit-test all objects and update selectedIds.
   * Also clears any previous selection.
   */
  /**
   * Finish drawing the lasso: hit-test all objects and update selectedIds.
   * Also clears any previous selection.
   */
  commitLasso(store: ObjectStore): void {
    this.isDrawingLasso = false;

    const lasso = this.lassoPoints;
    this.lassoPoints = [];

    if (lasso.length < 3) {
      // Treat as a click: try selecting the topmost object under the click point
      const clickPoint = lasso[0] || { x: 0, y: 0 };
      const clickedObj = this.findObjectAt(clickPoint.x, clickPoint.y, store);
      this.selectedIds.clear();
      if (clickedObj) {
        this.selectedIds.add(clickedObj.id);
      }
      this.onSelectionChange?.();
      return;
    }

    const newSelection = new Set<string>();
    for (const obj of store.getAll()) {
      if (this.hiddenLayerIds.has(obj.layerId)) {
        continue;
      }
      if (objectIntersectsLasso(obj, lasso)) {
        newSelection.add(obj.id);
      }
    }

    this.selectedIds = newSelection;
    this.onSelectionChange?.();
  }

  /** Select a specific object by ID directly (e.g. on new image import) */
  selectObject(id: string): void {
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this.onSelectionChange?.();
  }

  private findObjectAt(px: number, py: number, store: ObjectStore): DrawObject | undefined {
    const all = store.getAll();
    // Search in reverse order to find the topmost object first
    for (let i = all.length - 1; i >= 0; i--) {
      const obj = all[i];
      if (this.hiddenLayerIds.has(obj.layerId)) {
        continue;
      }
      if (obj.type === "image" || obj.type === "shape" || obj.type === "text") {
        const h = (obj as any).height ?? (obj.type === "text" ? (obj as any).fontSize ?? 16 : 0);
        if (
          px >= obj.x &&
          px <= obj.x + obj.width &&
          py >= obj.y &&
          py <= obj.y + h
        ) {
          return obj;
        }
      } else if (obj.type === "stroke") {
        // Simple distance-to-stroke-points check
        for (const p of obj.points) {
          const dx = px - p.x;
          const dy = py - p.y;
          if (dx * dx + dy * dy <= 64) { // 8px tolerance radius
            return obj;
          }
        }
      }
    }
    return undefined;
  }

  // =========================================================================
  // Selection queries
  // =========================================================================

  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds;
  }

  hasSelection(): boolean {
    return this.selectedIds.size > 0;
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.onSelectionChange?.();
  }

  deselectObjectsOnLayer(layerId: string, store: ObjectStore): void {
    let changed = false;
    for (const id of [...this.selectedIds]) {
      const obj = store.getById(id);
      if (obj && obj.layerId === layerId) {
        this.selectedIds.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.onSelectionChange?.();
    }
  }

  // =========================================================================
  // Move drag (translate)
  // =========================================================================

  /** Call on pointerdown inside the bounding box while objects are selected */
  startMove(x: number, y: number, store: ObjectStore): void {
    this.isDraggingMove = true;
    this.moveDragLastX = x;
    this.moveDragLastY = y;
    this.moveBeforeSnapshot = store.snapshot();
  }

  /** Call on pointermove to update positions */
  updateMove(x: number, y: number, store: ObjectStore): void {
    if (!this.isDraggingMove) return;
    const dx = x - this.moveDragLastX;
    const dy = y - this.moveDragLastY;
    this.moveDragLastX = x;
    this.moveDragLastY = y;

    for (const id of this.selectedIds) {
      const obj = store.getById(id);
      if (obj) {
        if (obj.type === "stroke") {
          this.onClearStrokeCache?.(id);
        }
        store.replace(id, translateObject(obj, dx, dy));
      }
    }
  }

  /** Call on pointerup to commit and record history */
  commitMove(store: ObjectStore, history: HistoryManager): void {
    if (!this.isDraggingMove || !this.moveBeforeSnapshot) return;
    this.isDraggingMove = false;

    history.pushAction({
      before: this.moveBeforeSnapshot,
      after: store.snapshot(),
    });

    this.moveBeforeSnapshot = null;
  }

  cancelMove(store: ObjectStore): void {
    if (!this.isDraggingMove || !this.moveBeforeSnapshot) return;
    store.replaceAll(this.moveBeforeSnapshot);
    this.isDraggingMove = false;
    this.moveBeforeSnapshot = null;
  }

  // =========================================================================
  // Resize drag (scale from handle)
  // =========================================================================

  startResize(
    handleIndex: number,
    startX: number,
    startY: number,
    store: ObjectStore
  ): void {
    const selectedObjs = getSelectedObjects(this.selectedIds, store);
    const bb = objectsBoundingBox(selectedObjs);
    if (!bb) return;

    this.isDraggingResize = true;
    this.resizeHandleIndex = handleIndex;
    this.resizeDragStartX = startX;
    this.resizeDragStartY = startY;
    this.resizeStartBB = { ...bb };
    this.resizeBeforeSnapshot = store.snapshot();
  }

  updateResize(x: number, y: number, store: ObjectStore): void {
    if (!this.isDraggingResize || !this.resizeStartBB) return;

    const bb = this.resizeStartBB;
    const { scaleX, scaleY, origin } = computeResizeScale(
      bb,
      this.resizeHandleIndex,
      this.resizeDragStartX,
      this.resizeDragStartY,
      x,
      y
    );

    // Restore to before-state first, then apply new scale
    if (this.resizeBeforeSnapshot) {
      store.replaceAll(JSON.parse(JSON.stringify(this.resizeBeforeSnapshot)));
    }

    for (const id of this.selectedIds) {
      const obj = store.getById(id);
      if (obj) {
        if (obj.type === "stroke") {
          this.onClearStrokeCache?.(id);
        }
        const scaled = scaleObjectById(obj, scaleX, scaleY, origin);
        store.replace(id, scaled);
      }
    }
  }

  commitResize(store: ObjectStore, history: HistoryManager): void {
    if (!this.isDraggingResize || !this.resizeBeforeSnapshot) return;
    this.isDraggingResize = false;

    history.pushAction({
      before: this.resizeBeforeSnapshot,
      after: store.snapshot(),
    });

    this.resizeBeforeSnapshot = null;
    this.resizeStartBB = null;
  }

  cancelResize(store: ObjectStore): void {
    if (!this.isDraggingResize || !this.resizeBeforeSnapshot) return;
    store.replaceAll(this.resizeBeforeSnapshot);
    this.isDraggingResize = false;
    this.resizeBeforeSnapshot = null;
    this.resizeStartBB = null;
  }

  // =========================================================================
  // Delete / Duplicate
  // =========================================================================

  deleteSelected(store: ObjectStore, history: HistoryManager): void {
    if (this.selectedIds.size === 0) return;

    const before = store.snapshot();
    store.remove([...this.selectedIds]);
    const after = store.snapshot();

    history.pushAction({ before, after });

    this.selectedIds.clear();
    this.onSelectionChange?.();
  }

  duplicateSelected(store: ObjectStore, history: HistoryManager): void {
    if (this.selectedIds.size === 0) return;

    const before = store.snapshot();

    const OFFSET = 16; // px offset so the copy is visually distinct
    const newIds = new Set<string>();

    for (const id of this.selectedIds) {
      const obj = store.getById(id);
      if (!obj) continue;

      const cloned = JSON.parse(JSON.stringify(obj)) as DrawObject;
      const now = new Date().toISOString();
      cloned.id = randomUUID();
      cloned.createdAt = now;
      cloned.updatedAt = now;

      // Offset the duplicate so it doesn't sit exactly on top
      const translated = translateObject(cloned, OFFSET, OFFSET);
      store.add(translated);
      newIds.add(translated.id);
    }

    const after = store.snapshot();
    history.pushAction({ before, after });

    // Select only the new duplicates
    this.selectedIds = newIds;
    this.onSelectionChange?.();
  }

  // =========================================================================
  // Hit-testing: given a canvas coordinate, return what the pointer is over
  // =========================================================================

  /** True if pointer is inside the current selection bounding box */
  isPointerInSelectionBB(x: number, y: number, store: ObjectStore): boolean {
    if (!this.hasSelection()) return false;
    const selectedObjs = getSelectedObjects(this.selectedIds, store);
    const bb = objectsBoundingBox(selectedObjs);
    if (!bb) return false;
    return (
      x >= bb.x - BB_PADDING &&
      x <= bb.x + bb.w + BB_PADDING &&
      y >= bb.y - BB_PADDING &&
      y <= bb.y + bb.h + BB_PADDING
    );
  }

  /** Return handle index under pointer, or -1 if none. Only for non-stroke selections. */
  hitTestResizeHandle(x: number, y: number, store: ObjectStore): number {
    if (!this.hasSelection()) return -1;
    const selectedObjs = getSelectedObjects(this.selectedIds, store);
    if (selectedObjs.every((o) => o.type === "stroke")) return -1; // strokes: move-only
    const bb = objectsBoundingBox(selectedObjs);
    if (!bb) return -1;
    const padded = padBB(bb, BB_PADDING);
    return hitTestHandle(getHandles(padded), x, y, HANDLE_RADIUS);
  }

  isDragging(): boolean {
    return this.isDraggingMove || this.isDraggingResize;
  }

  // =========================================================================
  // Rendering (onto the active canvas, which is cleared by the render loop)
  // =========================================================================

  /**
   * Draw the lasso outline (while drawing) or the selection bounding box
   * (when objects are selected) onto `ctx`.
   *
   * This is called:
   *  - by LassoTool on every pointermove (lasso preview)
   *  - by CanvasEngine.renderSelectionOverlay() after each committed redraw
   */
  renderOverlay(ctx: CanvasRenderingContext2D, store: ObjectStore): void {
    // --- Lasso in-progress preview ---
    if (this.isDrawingLasso && this.lassoPoints.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      ctx.closePath();
      ctx.setLineDash(BB_DASH);
      ctx.strokeStyle = "rgba(100, 160, 255, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "rgba(100, 160, 255, 0.08)";
      ctx.fill();
      ctx.restore();
      return;
    }

    // --- Selection bounding box + handles ---
    if (this.selectedIds.size === 0) return;

    const selectedObjs = getSelectedObjects(this.selectedIds, store);
    const bb = objectsBoundingBox(selectedObjs);
    if (!bb) return;

    const padded = padBB(bb, BB_PADDING);

    ctx.save();

    // Bounding box outline
    ctx.beginPath();
    ctx.rect(padded.x, padded.y, padded.w, padded.h);
    ctx.setLineDash(BB_DASH);
    ctx.strokeStyle = "rgba(100, 160, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Handles — only for non-stroke selections
    const allStrokes = selectedObjs.every((o) => o.type === "stroke");
    if (!allStrokes) {
      const handles = getHandles(padded);
      for (const h of handles) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(100, 160, 255, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  getCursorAt(x: number, y: number, store: ObjectStore): string {
    const handleIdx = this.hitTestResizeHandle(x, y, store);
    if (handleIdx !== -1) {
      const selectedObjs = getSelectedObjects(this.selectedIds, store);
      const bb = objectsBoundingBox(selectedObjs);
      if (bb) {
        const padded = padBB(bb, BB_PADDING);
        const handles = getHandles(padded);
        const h = handles.find((h) => h.index === handleIdx);
        if (h) return h.cursor;
      }
    }
    if (this.isPointerInSelectionBB(x, y, store)) {
      return "move";
    }
    return "default";
  }

  changeSelectedColor(color: string, store: ObjectStore, history: HistoryManager): void {
    if (this.selectedIds.size === 0) return;
    const before = store.snapshot();
    let changed = false;
    for (const id of this.selectedIds) {
      const obj = store.getById(id);
      if (obj && (obj.type === "stroke" || obj.type === "shape" || obj.type === "text")) {
        if (obj.type === "stroke") {
          this.onClearStrokeCache?.(id);
        }
        store.replace(id, {
          ...obj,
          updatedAt: new Date().toISOString(),
          color,
        } as any);
        changed = true;
      }
    }
    if (changed) {
      history.pushAction({ before, after: store.snapshot() });
    }
  }

  changeSelectedStrokeWidth(width: number, store: ObjectStore, history: HistoryManager): void {
    if (this.selectedIds.size === 0) return;
    const before = store.snapshot();
    let changed = false;
    for (const id of this.selectedIds) {
      const obj = store.getById(id);
      if (obj) {
        if (obj.type === "stroke") {
          this.onClearStrokeCache?.(id);
          store.replace(id, {
            ...obj,
            updatedAt: new Date().toISOString(),
            baseWidth: width,
          });
          changed = true;
        } else if (obj.type === "shape") {
          store.replace(id, {
            ...obj,
            updatedAt: new Date().toISOString(),
            strokeWidth: width,
          });
          changed = true;
        } else if (obj.type === "text") {
          // Map strokeWidth to text font size: e.g. 2px -> 12px, 4px -> 16px, 8px -> 24px
          const fs = width === 2 ? 12 : width === 4 ? 16 : width === 8 ? 24 : width * 4;
          store.replace(id, {
            ...obj,
            updatedAt: new Date().toISOString(),
            fontSize: fs,
            height: undefined, // trigger text re-measure
          });
          changed = true;
        }
      }
    }
    if (changed) {
      history.pushAction({ before, after: store.snapshot() });
    }
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function getSelectedObjects(
  ids: ReadonlySet<string>,
  store: ObjectStore
): DrawObject[] {
  const result: DrawObject[] = [];
  for (const id of ids) {
    const obj = store.getById(id);
    if (obj) result.push(obj);
  }
  return result;
}

function objectIntersectsLasso(
  obj: DrawObject,
  lasso: { x: number; y: number }[]
): boolean {
  switch (obj.type) {
    case "stroke":
      return strokeIntersectsLasso(obj, lasso);
    case "shape":
      return bbIntersectsLasso(obj as any, lasso);
    case "text":
      return bbIntersectsLasso(obj as any, lasso);
    case "image":
      return bbIntersectsLasso(obj as any, lasso);
  }
}

function padBB(bb: BoundingBox, pad: number): BoundingBox {
  return {
    x: bb.x - pad,
    y: bb.y - pad,
    w: bb.w + pad * 2,
    h: bb.h + pad * 2,
  };
}

// Compute the scale factors and origin for a resize drag
function computeResizeScale(
  bb: BoundingBox,
  handleIndex: number,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): { scaleX: number; scaleY: number; origin: { x: number; y: number } } {
  const dx = currentX - startX;
  const dy = currentY - startY;

  // Origin is the opposite corner/edge from the dragged handle
  const originX =
    handleIndex === 0 || handleIndex === 6 || handleIndex === 7
      ? bb.x + bb.w  // dragging left-side handles → origin is right edge
      : bb.x;         // dragging right-side handles → origin is left edge

  const originY =
    handleIndex === 0 || handleIndex === 1 || handleIndex === 2
      ? bb.y + bb.h  // dragging top handles → origin is bottom edge
      : bb.y;         // dragging bottom handles → origin is top edge

  const newW = Math.max(
    10,
    handleIndex === 3 || handleIndex === 4 || handleIndex === 5 // right/bottom
      ? bb.w + dx
      : handleIndex === 7 || handleIndex === 6 || handleIndex === 0
      ? bb.w - dx
      : bb.w
  );

  const newH = Math.max(
    10,
    handleIndex === 4 || handleIndex === 5 || handleIndex === 6 // bottom
      ? bb.h + dy
      : handleIndex === 0 || handleIndex === 1 || handleIndex === 2
      ? bb.h - dy
      : bb.h
  );

  return {
    scaleX: bb.w > 0 ? newW / bb.w : 1,
    scaleY: bb.h > 0 ? newH / bb.h : 1,
    origin: { x: originX, y: originY },
  };
}

function scaleObjectById(
  obj: DrawObject,
  scaleX: number,
  scaleY: number,
  origin: { x: number; y: number }
): DrawObject {
  // Import here to avoid circular dep — inline the logic for strokes
  if (obj.type === "stroke") {
    return {
      ...obj,
      updatedAt: new Date().toISOString(),
      points: obj.points.map((p) => ({
        ...p,
        x: origin.x + (p.x - origin.x) * scaleX,
        y: origin.y + (p.y - origin.y) * scaleY,
      })),
    };
  }
  if (obj.type === "shape" || obj.type === "image") {
    return {
      ...obj,
      updatedAt: new Date().toISOString(),
      x: origin.x + (obj.x - origin.x) * scaleX,
      y: origin.y + (obj.y - origin.y) * scaleY,
      width: obj.width * scaleX,
      height: obj.height * scaleY,
    };
  }
  if (obj.type === "text") {
    return {
      ...obj,
      updatedAt: new Date().toISOString(),
      x: origin.x + (obj.x - origin.x) * scaleX,
      y: origin.y + (obj.y - origin.y) * scaleY,
      width: obj.width * scaleX,
    };
  }
  return obj;
}
