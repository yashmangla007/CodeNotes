// ---------------------------------------------------------------------------
// eraserTool.ts — Eraser tool supporting whole stroke and pixel erase modes
//
// Implements PRD §7.2 (two modes: stroke and pixel eraser) and §7.3.
// ---------------------------------------------------------------------------

import type { CanvasEngine } from "./canvasEngine";

export type EraserMode = "stroke" | "pixel";

export class EraserTool {
  private isErasing = false;
  private activePointerId: number | null = null;
  /** Active pen pointer ID for palm rejection (TRD §6.3) */
  private activePenPointerId: number | null = null;

  private prevX = 0;
  private prevY = 0;

  /** Eraser radius in pixels */
  public radius = 16;
  /** Current mode: stroke (whole stroke) or pixel (partial split) */
  public mode: EraserMode = "stroke";

  constructor(private readonly engine: CanvasEngine) {}

  // ---- Event wiring -------------------------------------------------------

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
  }

  detach(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.isErasing = false;
    this.activePointerId = null;
  }

  // ---- Pointer event handlers ---------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    // Only handle primary pointer click/drag
    if (!e.isPrimary) {
      return;
    }

    // Palm rejection (TRD §6.3)
    if (e.pointerType === "touch" && this.activePenPointerId !== null) {
      return;
    }
    if (e.pointerType === "pen") {
      this.activePenPointerId = e.pointerId;
    }

    const pos = this.getPos(e);
    this.isErasing = true;
    this.activePointerId = e.pointerId;
    this.prevX = pos.x;
    this.prevY = pos.y;

    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    // Notify engine we are starting an erase gesture to capture history
    this.engine.startEraseGesture();

    // Perform initial erase check at down point
    this.eraseAt(pos.x, pos.y);
    this.drawPreview(pos.x, pos.y);

    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.isErasing || e.pointerId !== this.activePointerId) {
      return;
    }

    // Palm rejection (TRD §6.3)
    if (e.pointerType === "touch" && this.activePenPointerId !== null && e.pointerId !== this.activePenPointerId) {
      return;
    }

    const pos = this.getPos(e);

    // Erase along the segment from previous point to current point
    this.engine.eraseAlongSegment({ x: this.prevX, y: this.prevY }, pos, this.radius, this.mode);

    this.prevX = pos.x;
    this.prevY = pos.y;

    this.drawPreview(pos.x, pos.y);

    e.preventDefault();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.isErasing || e.pointerId !== this.activePointerId) {
      return;
    }

    this.isErasing = false;
    this.activePointerId = null;
    if (e.pointerType === "pen") {
      this.activePenPointerId = null;
    }

    // Clear the active canvas (removes the circle preview)
    this.engine.clearActiveCanvas();

    // Commit the erase gesture (creates undo/redo step and triggers save)
    this.engine.commitEraseGesture();

    e.preventDefault();
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointerId) {
      this.isErasing = false;
      this.activePointerId = null;
      if (e.pointerType === "pen") {
        this.activePenPointerId = null;
      }
      this.engine.clearActiveCanvas();
      
      // Rollback or commit what was done (commit is fine for cancel)
      this.engine.commitEraseGesture();
    }
  };

  // ---- Helpers -------------------------------------------------------------

  private getPos(e: PointerEvent): { x: number; y: number } {
    return this.engine.clientToDocument(e.clientX, e.clientY);
  }

  private eraseAt(x: number, y: number): void {
    this.engine.eraseAlongSegment({ x, y }, { x, y }, this.radius, this.mode);
  }

  /** Render a circle outline representing the eraser boundary */
  private drawPreview(x: number, y: number): void {
    const ctx = this.engine.activeCanvasElement.getContext("2d")!;
    const { width, height } = this.engine.activeCanvasElement;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.scale(this.engine.zoomScale, this.engine.zoomScale);

    ctx.beginPath();
    ctx.arc(x, y, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Add a light fill to make it easier to see
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    ctx.fill();

    ctx.restore();
  }
}
