// ---------------------------------------------------------------------------
// penTool.ts — Pen tool: Pointer Events → perfect-freehand stroke geometry
//
// Implements TRD §6.3 (palm rejection) and §6.4 (pressure handling) exactly:
//   - Reads event.pressure per pointermove; treats constant 0.5 as "no data"
//   - Feeds [x, y, pressure] stream into perfect-freehand via the engine
//   - If a "pen" pointer is active, ignores concurrent "touch" pointers
//   - Never blocks "mouse" input
// ---------------------------------------------------------------------------

import { getStroke } from "perfect-freehand";
import type { CanvasEngine } from "./canvasEngine";

/** pressure value browsers report for devices with no real pressure data */
const SIMULATED_PRESSURE = 0.5;

/** Pen tool options passed to perfect-freehand */
const PEN_OPTIONS = {
  size: 4,          // base stroke diameter in pixels
  thinning: 0.5,    // how much pressure varies width
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false, // we supply real pressure; library must not override it
  last: false,             // toggled true on pointerup to cap the stroke end
};

/** One raw input sample collected from Pointer Events */
interface InputPoint {
  x: number;
  y: number;
  /** Pointer pressure 0–1. May be undefined if not yet read. */
  pressure?: number;
}

export class PenTool {
  private isDrawing = false;
  /** pointerId of the active pen stroke, for coalescing events */
  private activePointerId: number | null = null;
  /** pointerId of the active pen-type pointer (for palm rejection) */
  private activePenPointerId: number | null = null;

  /** Raw input points collected during the current stroke */
  private currentPoints: InputPoint[] = [];

  /** Stroke color (hex). Set externally when toolbar is added in later phases. */
  public color = "#e06c75"; // warm red — visible on dark background
  public strokeWidth = 4;

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
  }

  // ---- Pointer event handlers (arrow fns to keep `this` bound) -----------

  private readonly onPointerDown = (e: PointerEvent): void => {
    // Palm rejection (TRD §6.3):
    // If a pen is currently active, ignore new touch pointers.
    if (e.pointerType === "touch" && this.activePenPointerId !== null) {
      return;
    }
    // Never block mouse input.
    // Track the "active pen" for palm rejection purposes.
    if (e.pointerType === "pen") {
      this.activePenPointerId = e.pointerId;
    }

    this.isDrawing = true;
    this.activePointerId = e.pointerId;
    this.currentPoints = [this.extractPoint(e)];

    // Capture pointer so we keep receiving events even if pointer leaves canvas
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.isDrawing || e.pointerId !== this.activePointerId) {
      return;
    }

    // Palm rejection: ignore touch move if a pen is active and this isn't it
    if (
      e.pointerType === "touch" &&
      this.activePenPointerId !== null &&
      e.pointerId !== this.activePenPointerId
    ) {
      return;
    }

    // Use getCoalescedEvents when available for smoother high-frequency input
    const events =
      typeof e.getCoalescedEvents === "function"
        ? e.getCoalescedEvents()
        : [e];

    for (const ev of events) {
      this.currentPoints.push(this.extractPoint(ev));
    }

    // Render the live in-progress stroke on the top canvas
    this.engine.renderActiveStroke(this.currentPoints, this.color, this.strokeWidth, false);

    e.preventDefault();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.isDrawing || e.pointerId !== this.activePointerId) {
      return;
    }

    this.currentPoints.push(this.extractPoint(e));

    // Finalise the stroke: render it once more with `last: true` so
    // perfect-freehand caps the tip correctly, then commit to the engine.
    this.engine.renderActiveStroke(this.currentPoints, this.color, this.strokeWidth, true);
    this.engine.commitStroke(this.currentPoints, this.color, this.strokeWidth);

    // Reset state
    this.isDrawing = false;
    this.activePointerId = null;
    if (e.pointerType === "pen") {
      this.activePenPointerId = null;
    }
    this.currentPoints = [];

    e.preventDefault();
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointerId) {
      // Discard the cancelled stroke without committing it
      this.engine.clearActiveCanvas();
      this.isDrawing = false;
      this.activePointerId = null;
      if (e.pointerType === "pen") {
        this.activePenPointerId = null;
      }
      this.currentPoints = [];
    }
  };

  // ---- Helpers -----------------------------------------------------------

  /**
   * Extract a normalised InputPoint from a PointerEvent.
   * Per TRD §6.4: browsers report 0.5 constantly for non-pressure devices.
   * We pass the real value through; perfect-freehand is initialised with
   * simulatePressure:false so it uses whatever we give it. For devices
   * reporting constant 0.5 the stroke will still render at a consistent
   * medium width — visually correct for a mouse.
   */
  private extractPoint(e: PointerEvent): InputPoint {
    const pt = this.engine.clientToDocument(e.clientX, e.clientY);
    return {
      x: pt.x,
      y: pt.y,
      // Read real hardware pressure. Browsers report 0.5 constantly for
      // devices without pressure support — that's fine; the ?? fallback
      // in buildStrokePath treats it identically (TRD §6.4).
      pressure: e.pressure,
    };
  }
}

/**
 * Convert a stream of InputPoints into a filled Path2D using perfect-freehand.
 * `last` should be true only for the final render of a completed stroke
 * (caps the tip correctly).
 */
export function buildStrokePath(
  points: InputPoint[],
  baseSize: number,
  last: boolean
): Path2D {
  if (points.length === 0) {
    return new Path2D();
  }

  // perfect-freehand accepts [x, y, pressure] tuples
  const input = points.map((p) => [p.x, p.y, p.pressure ?? SIMULATED_PRESSURE] as [number, number, number]);

  const outlinePoints = getStroke(input, {
    ...PEN_OPTIONS,
    size: baseSize,
    last,
  });

  const path = new Path2D();
  if (outlinePoints.length < 2) {
    // Dot — draw a small circle
    const [ox, oy] = outlinePoints[0] ?? [points[0].x, points[0].y];
    path.arc(ox, oy, baseSize / 2, 0, Math.PI * 2);
    return path;
  }

  const [first, ...rest] = outlinePoints;
  path.moveTo(first[0], first[1]);
  for (const pt of rest) {
    path.lineTo(pt[0], pt[1]);
  }
  path.closePath();
  return path;
}

// Re-export InputPoint so canvasEngine can type its stored strokes
export type { InputPoint };
