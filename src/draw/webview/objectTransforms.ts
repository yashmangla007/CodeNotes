// ---------------------------------------------------------------------------
// objectTransforms.ts — Pure per-type transform functions for DrawObjects
//
// Adding support for a new object type (Phase 6 shapes/text, Phase 7 images)
// means adding one `case` branch in each function here — nowhere else.
//
// All functions return NEW objects (no mutation of the original).
// ---------------------------------------------------------------------------

import type { DrawObject, StrokeObject } from "../drawTypes";

// ---- Translation -----------------------------------------------------------

/**
 * Return a copy of `obj` translated by (dx, dy) in canvas pixels.
 */
export function translateObject(
  obj: DrawObject,
  dx: number,
  dy: number
): DrawObject {
  switch (obj.type) {
    case "stroke":
      return {
        ...obj,
        updatedAt: new Date().toISOString(),
        points: obj.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
      } satisfies StrokeObject;

    case "shape":
      return { ...obj, updatedAt: new Date().toISOString(), x: obj.x + dx, y: obj.y + dy };

    case "text":
      return { ...obj, updatedAt: new Date().toISOString(), x: obj.x + dx, y: obj.y + dy };

    case "image":
      return { ...obj, updatedAt: new Date().toISOString(), x: obj.x + dx, y: obj.y + dy };
  }
}

// ---- Scaling ---------------------------------------------------------------

/**
 * Return a copy of `obj` scaled by (scaleX, scaleY) relative to `origin`.
 * For strokes each control point is scaled. For box-based objects the
 * x/y/width/height are updated.
 *
 * NOTE: per the Phase 5 plan, resize handles are only shown for non-stroke
 * objects.  This function is still implemented for strokes so that future
 * phases can opt into it if desired.
 */
export function scaleObject(
  obj: DrawObject,
  scaleX: number,
  scaleY: number,
  origin: { x: number; y: number }
): DrawObject {
  switch (obj.type) {
    case "stroke":
      return {
        ...obj,
        updatedAt: new Date().toISOString(),
        points: obj.points.map((p) => ({
          ...p,
          x: origin.x + (p.x - origin.x) * scaleX,
          y: origin.y + (p.y - origin.y) * scaleY,
        })),
      } satisfies StrokeObject;

    case "shape":
      return {
        ...obj,
        updatedAt: new Date().toISOString(),
        x: origin.x + (obj.x - origin.x) * scaleX,
        y: origin.y + (obj.y - origin.y) * scaleY,
        width: obj.width * scaleX,
        height: obj.height * scaleY,
      };

    case "text":
      return {
        ...obj,
        updatedAt: new Date().toISOString(),
        x: origin.x + (obj.x - origin.x) * scaleX,
        y: origin.y + (obj.y - origin.y) * scaleY,
        width: obj.width * scaleX,
      };

    case "image":
      return {
        ...obj,
        updatedAt: new Date().toISOString(),
        x: origin.x + (obj.x - origin.x) * scaleX,
        y: origin.y + (obj.y - origin.y) * scaleY,
        width: obj.width * scaleX,
        height: obj.height * scaleY,
      };
  }
}
