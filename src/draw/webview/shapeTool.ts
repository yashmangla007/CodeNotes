// ---------------------------------------------------------------------------
// shapeTool.ts — Tool for drawing geometric shapes with Shift snapping
//
// Implements Phase 6 shapes (line, arrow, rectangle, ellipse).
// Reuses the SelectionManager/ObjectStore/History architecture.
// ---------------------------------------------------------------------------

import type { CanvasEngine } from "./canvasEngine";
import type { ShapeObject, DrawObject } from "../drawTypes";
import { randomUUID } from "./uuid";

export class ShapeTool {
  private isDrawing = false;
  private activePointerId: number | null = null;
  /** Active pen pointer ID for palm rejection (TRD §6.3) */
  private activePenPointerId: number | null = null;
  private startX = 0;
  private startY = 0;

  // History snapshot before starting the shape draw
  private beforeSnapshot: DrawObject[] | null = null;

  // Active settings
  public shapeType: "line" | "arrow" | "rectangle" | "ellipse" = "line";
  public color = "#e06c75";
  public strokeWidth = 4;

  constructor(private readonly engine: CanvasEngine) {}

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
    this.isDrawing = false;
    this.activePointerId = null;
  }

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
    this.isDrawing = true;
    this.activePointerId = e.pointerId;
    this.startX = pos.x;
    this.startY = pos.y;

    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    // Snapshot for history
    this.beforeSnapshot = this.engine.getStore().snapshot();

    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.isDrawing || e.pointerId !== this.activePointerId) return;

    // Palm rejection (TRD §6.3)
    if (e.pointerType === "touch" && this.activePenPointerId !== null && e.pointerId !== this.activePenPointerId) {
      return;
    }

    const pos = this.getPos(e);
    
    // Apply shift constraints
    let { width, height } = this.calculateDimensions(pos.x, pos.y, e.shiftKey);

    // Draw live preview on active canvas
    this.drawPreview(pos.x, pos.y, width, height);

    e.preventDefault();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.isDrawing || e.pointerId !== this.activePointerId) return;

    const pos = this.getPos(e);
    
    // Apply shift constraints
    let { width, height } = this.calculateDimensions(pos.x, pos.y, e.shiftKey);

    this.isDrawing = false;
    this.activePointerId = null;
    if (e.pointerType === "pen") {
      this.activePenPointerId = null;
    }

    // Discard tiny clicks/shapes
    if (Math.hypot(width, height) < 3) {
      this.engine.clearActiveCanvas();
      this.beforeSnapshot = null;
      return;
    }

    // Create the ShapeObject
    const now = new Date().toISOString();
    const newShape: ShapeObject = {
      id: randomUUID(),
      layerId: this.engine.activeLayerId,
      createdAt: now,
      updatedAt: now,
      opacity: 1,
      type: "shape",
      shape: this.shapeType,
      color: this.color,
      strokeWidth: this.strokeWidth,
      x: this.startX,
      y: this.startY,
      width,
      height,
    };

    if (this.beforeSnapshot) {
      // Add to store
      this.engine.getStore().add(newShape);

      // Record in history
      this.engine.getHistory().pushAction({
        before: this.beforeSnapshot,
        after: this.engine.getStore().snapshot(),
      });
    }

    this.engine.clearActiveCanvas();
    this.beforeSnapshot = null;

    // Trigger save and repaint committed canvas
    this.engine.onChanged?.();
    (this.engine as any).redrawCommitted(); // Force repaint

    e.preventDefault();
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointerId) {
      this.isDrawing = false;
      this.activePointerId = null;
      if (e.pointerType === "pen") {
        this.activePenPointerId = null;
      }
      this.engine.clearActiveCanvas();
      this.beforeSnapshot = null;
    }
  };

  // ---- Helpers -------------------------------------------------------------

  private getPos(e: PointerEvent): { x: number; y: number } {
    return this.engine.clientToDocument(e.clientX, e.clientY);
  }

  private calculateDimensions(
    currX: number,
    currY: number,
    shiftPressed: boolean
  ): { width: number; height: number } {
    let dx = currX - this.startX;
    let dy = currY - this.startY;

    if (shiftPressed) {
      if (this.shapeType === "rectangle" || this.shapeType === "ellipse") {
        // Constrain to square / circle
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx) * size;
        dy = Math.sign(dy) * size;
      } else if (this.shapeType === "line" || this.shapeType === "arrow") {
        // Constrain to 45 degree increments
        const angle = Math.atan2(dy, dx);
        const roundedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        dx = dist * Math.cos(roundedAngle);
        dy = dist * Math.sin(roundedAngle);
      }
    }

    return { width: dx, height: dy };
  }

  private drawPreview(
    currX: number,
    currY: number,
    width: number,
    height: number
  ): void {
    const canvas = this.engine.activeCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();
    ctx.scale(this.engine.zoomScale, this.engine.zoomScale);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    switch (this.shapeType) {
      case "line":
        ctx.beginPath();
        ctx.moveTo(this.startX, this.startY);
        ctx.lineTo(this.startX + width, this.startY + height);
        ctx.stroke();
        break;

      case "arrow":
        ctx.beginPath();
        ctx.moveTo(this.startX, this.startY);
        ctx.lineTo(this.startX + width, this.startY + height);
        ctx.stroke();
        this.drawArrowhead(ctx, this.startX, this.startY, this.startX + width, this.startY + height);
        break;

      case "rectangle":
        ctx.beginPath();
        ctx.rect(this.startX, this.startY, width, height);
        ctx.stroke();
        break;

      case "ellipse":
        ctx.beginPath();
        const rx = Math.abs(width) / 2;
        const ry = Math.abs(height) / 2;
        const cx = this.startX + width / 2;
        const cy = this.startY + height / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }

  private drawArrowhead(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): void {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const headLength = Math.max(10, 8 + this.strokeWidth * 2);
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
}
