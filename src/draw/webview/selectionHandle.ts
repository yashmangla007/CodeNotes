// ---------------------------------------------------------------------------
// selectionHandle.ts — Pure geometry helpers for selection bounding boxes
//                      and resize handles
//
// No DOM / canvas side-effects here.  All functions are pure.
// ---------------------------------------------------------------------------

import type { DrawObject, StrokeObject } from "../drawTypes";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Handle {
  x: number;
  y: number;
  /** CSS cursor string to show when hovering this handle */
  cursor: string;
  /** Which corner/edge: 0=TL,1=TC,2=TR,3=RC,4=BR,5=BC,6=BL,7=LC */
  index: number;
}

// ---- Bounding box ----------------------------------------------------------

/**
 * Compute a bounding box that encloses all points across all `objects`.
 * Returns null if the object list is empty or has no measurable geometry.
 */
export function objectsBoundingBox(
  objects: ReadonlyArray<DrawObject>
): BoundingBox | null {
  if (objects.length === 0) {
    return null;
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const obj of objects) {
    const pts = getObjectPoints(obj);
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!isFinite(minX)) {
    return null;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Return a flat list of [x, y] pairs representing the object's geometry. */
function getObjectPoints(obj: DrawObject): [number, number][] {
  switch (obj.type) {
    case "stroke":
      return obj.points.map((p) => [p.x, p.y]);

    case "shape":
    case "text":
    case "image":
      // Box-based objects: return the four corners
      return [
        [obj.x, obj.y],
        [obj.x + obj.width, obj.y],
        [obj.x, obj.y + ((obj as any).height ?? 0)],
        [obj.x + obj.width, obj.y + ((obj as any).height ?? 0)],
      ];
  }
}

// ---- Resize handles --------------------------------------------------------

const HANDLE_CURSORS = [
  "nw-resize", // 0 TL
  "n-resize",  // 1 TC
  "ne-resize", // 2 TR
  "e-resize",  // 3 RC
  "se-resize", // 4 BR
  "s-resize",  // 5 BC
  "sw-resize", // 6 BL
  "w-resize",  // 7 LC
];

/**
 * Return the 8 resize handle positions (clockwise from TL) for `bb`.
 * Handle radius and exact pixel position are the caller's concern.
 */
export function getHandles(bb: BoundingBox): Handle[] {
  const { x, y, w, h } = bb;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = x + w;
  const by = y + h;

  return [
    { index: 0, x,  y,  cursor: HANDLE_CURSORS[0] }, // TL
    { index: 1, x: cx, y,  cursor: HANDLE_CURSORS[1] }, // TC
    { index: 2, x: rx, y,  cursor: HANDLE_CURSORS[2] }, // TR
    { index: 3, x: rx, y: cy, cursor: HANDLE_CURSORS[3] }, // RC
    { index: 4, x: rx, y: by, cursor: HANDLE_CURSORS[4] }, // BR
    { index: 5, x: cx, y: by, cursor: HANDLE_CURSORS[5] }, // BC
    { index: 6, x,  y: by, cursor: HANDLE_CURSORS[6] }, // BL
    { index: 7, x,  y: cy, cursor: HANDLE_CURSORS[7] }, // LC
  ];
}

/** Hit-test radius in canvas pixels for handle click detection. */
export const HANDLE_RADIUS = 6;

/**
 * Return the index of the handle at (px, py), or -1 if none.
 */
export function hitTestHandle(
  handles: Handle[],
  px: number,
  py: number,
  radius: number = HANDLE_RADIUS
): number {
  for (const h of handles) {
    const dx = px - h.x;
    const dy = py - h.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return h.index;
    }
  }
  return -1;
}

// ---- Point-in-polygon (ray casting) ----------------------------------------

/**
 * Determine whether point (px, py) is inside the polygon defined by `vertices`.
 * Uses the ray-casting algorithm — O(n) in vertex count.
 */
export function pointInPolygon(
  px: number,
  py: number,
  vertices: { x: number; y: number }[]
): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

// ---- Stroke–lasso intersection test ----------------------------------------

/**
 * Return true if any control point of `stroke` falls inside the lasso polygon,
 * OR if the stroke's bounding box overlaps the lasso bounding box when the
 * lasso is a rough convex hull (keeps selection feeling snappy for short
 * strokes with few control points).
 */
export function strokeIntersectsLasso(
  stroke: StrokeObject,
  lasso: { x: number; y: number }[]
): boolean {
  if (lasso.length < 3) {
    return false;
  }
  for (const p of stroke.points) {
    if (pointInPolygon(p.x, p.y, lasso)) {
      return true;
    }
  }
  return false;
}

/**
 * Return true if the axis-aligned bounding box of an object overlaps the
 * lasso polygon.  Used for box-based object types (shapes, text, images).
 */
export function bbIntersectsLasso(
  obj: DrawObject & { x: number; y: number; width: number; height?: number },
  lasso: { x: number; y: number }[]
): boolean {
  if (lasso.length < 3) {
    return false;
  }
  const h = (obj as any).height ?? 0;
  // Check all four corners of the bounding box
  const corners: { x: number; y: number }[] = [
    { x: obj.x, y: obj.y },
    { x: obj.x + obj.width, y: obj.y },
    { x: obj.x + obj.width, y: obj.y + h },
    { x: obj.x, y: obj.y + h },
  ];
  for (const c of corners) {
    if (pointInPolygon(c.x, c.y, lasso)) {
      return true;
    }
  }
  // Also check if the lasso centroid is inside the object's bbox (catches
  // small lassos drawn entirely inside a large object)
  const cx =
    lasso.reduce((s, p) => s + p.x, 0) / lasso.length;
  const cy =
    lasso.reduce((s, p) => s + p.y, 0) / lasso.length;
  return cx >= obj.x && cx <= obj.x + obj.width && cy >= obj.y && cy <= obj.y + h;
}
