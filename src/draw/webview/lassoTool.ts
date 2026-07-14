// ---------------------------------------------------------------------------
// lassoTool.ts — Pointer Events adapter for the lasso selection gesture
//
// This file contains ONLY input routing — all geometry and selection logic
// lives in SelectionManager.  The tool:
//   1. Handles the lasso-draw gesture (pointerdown → move → up)
//   2. Handles move-drag when pointer goes down inside the selection BB
//   3. Handles resize-handle drag when pointer goes down on a handle
//
// After every relevant pointer event it triggers a canvas redraw via
// the `onNeedsRedraw` callback (provided by CanvasEngine).
// ---------------------------------------------------------------------------

import type { ObjectStore } from "./objectStore";
import type { HistoryManager } from "./historyManager";
import { SelectionManager } from "./selectionManager";
import { CanvasEngine } from "./canvasEngine";

export class LassoTool {
  private activePointerId: number | null = null;
  /** Active pen pointer ID for palm rejection (TRD §6.3) */
  private activePenPointerId: number | null = null;
  /** Which gesture is active: lasso draw, move, or resize */
  private gesture: "lasso" | "move" | "resize" | "none" = "none";
  private canvasElement: HTMLCanvasElement | null = null;

  constructor(
    private readonly engine: CanvasEngine,
    private readonly selectionManager: SelectionManager,
    private readonly store: ObjectStore,
    private readonly history: HistoryManager,
    /** Called whenever canvas needs a repaint (clears active canvas + renderOverlay) */
    private readonly onNeedsRedraw: () => void,
    /** Called when a mutating gesture is committed to disk */
    private readonly onCommitChange?: () => void
  ) {}

  // ---- Event wiring -------------------------------------------------------

  attach(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
  }

  detach(canvas: HTMLCanvasElement): void {
    this.canvasElement = null;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.gesture = "none";
    this.activePointerId = null;
  }

  // ---- Pointer event handlers (arrow fns to keep `this` bound) -----------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;

    // Palm rejection (TRD §6.3)
    if (e.pointerType === "touch" && this.activePenPointerId !== null) {
      return;
    }
    if (e.pointerType === "pen") {
      this.activePenPointerId = e.pointerId;
    }

    const pos = this.getPos(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    this.activePointerId = e.pointerId;

    // Priority: resize handle → move drag → new lasso
    const handleIdx = this.selectionManager.hitTestResizeHandle(
      pos.x,
      pos.y,
      this.store
    );

    if (handleIdx !== -1) {
      // Start a resize gesture
      this.gesture = "resize";
      this.selectionManager.startResize(handleIdx, pos.x, pos.y, this.store);
    } else if (
      this.selectionManager.isPointerInSelectionBB(pos.x, pos.y, this.store)
    ) {
      // Start a move gesture
      this.gesture = "move";
      this.selectionManager.startMove(pos.x, pos.y, this.store);
    } else {
      // Start a new lasso
      this.gesture = "lasso";
      this.selectionManager.startLasso();
      this.selectionManager.updateLasso(pos.x, pos.y);
    }

    this.onNeedsRedraw();
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const pos = this.getPos(e);

    if (e.pointerId !== this.activePointerId) {
      // Hover cursor style update
      const canvas = e.currentTarget as HTMLCanvasElement;
      canvas.style.cursor = this.selectionManager.getCursorAt(pos.x, pos.y, this.store);
      return;
    }

    // Palm rejection (TRD §6.3)
    if (e.pointerType === "touch" && this.activePenPointerId !== null && e.pointerId !== this.activePenPointerId) {
      return;
    }

    switch (this.gesture) {
      case "lasso":
        this.selectionManager.updateLasso(pos.x, pos.y);
        break;
      case "move":
        this.selectionManager.updateMove(pos.x, pos.y, this.store);
        break;
      case "resize":
        this.selectionManager.updateResize(pos.x, pos.y, this.store);
        break;
    }

    this.onNeedsRedraw();
    e.preventDefault();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;

    const pos = this.getPos(e);

    switch (this.gesture) {
      case "lasso":
        this.selectionManager.updateLasso(pos.x, pos.y);
        this.selectionManager.commitLasso(this.store);
        break;
      case "move":
        this.selectionManager.updateMove(pos.x, pos.y, this.store);
        this.selectionManager.commitMove(this.store, this.history);
        this.onCommitChange?.();
        break;
      case "resize":
        this.selectionManager.updateResize(pos.x, pos.y, this.store);
        this.selectionManager.commitResize(this.store, this.history);
        this.onCommitChange?.();
        break;
    }

    this.gesture = "none";
    this.activePointerId = null;
    if (e.pointerType === "pen") {
      this.activePenPointerId = null;
    }
    this.onNeedsRedraw();
    e.preventDefault();
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;

    switch (this.gesture) {
      case "move":
        this.selectionManager.cancelMove(this.store);
        break;
      case "resize":
        this.selectionManager.cancelResize(this.store);
        break;
      default:
        this.selectionManager.clearSelection();
        break;
    }

    this.gesture = "none";
    this.activePointerId = null;
    if (e.pointerType === "pen") {
      this.activePenPointerId = null;
    }
    this.onNeedsRedraw();
    this.onCommitChange?.();
  };

  // ---- Helpers -------------------------------------------------------------

  private getPos(e: PointerEvent): { x: number; y: number } {
    return this.engine.clientToDocument(e.clientX, e.clientY);
  }
}
