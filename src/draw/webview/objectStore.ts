// ---------------------------------------------------------------------------
// objectStore.ts — Unified in-memory store for all draw objects
//
// This is the single source of truth for every DrawObject in the current
// session.  CanvasEngine reads from it to render; all tools (pen, eraser,
// lasso) write to it via the methods below.
//
// Deep-clone semantics: snapshot() returns a plain-JS-object copy of the
// array that is safe to pass to HistoryManager without aliasing issues.
// ---------------------------------------------------------------------------

import type { DrawObject } from "../drawTypes";

export class ObjectStore {
  private objects: DrawObject[] = [];

  // ---- Read ----------------------------------------------------------------

  getAll(): ReadonlyArray<DrawObject> {
    return this.objects;
  }

  getById(id: string): DrawObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  /** Deep clone of the current state for history snapshots. */
  snapshot(): DrawObject[] {
    return JSON.parse(JSON.stringify(this.objects)) as DrawObject[];
  }

  // ---- Write ---------------------------------------------------------------

  add(obj: DrawObject): void {
    this.objects.push(obj);
  }

  remove(ids: string[]): void {
    const idSet = new Set(ids);
    this.objects = this.objects.filter((o) => !idSet.has(o.id));
  }

  /** Replace a single object by id (used by eraser pixel-split and resize). */
  replace(id: string, next: DrawObject): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx !== -1) {
      this.objects[idx] = next;
    }
  }

  /**
   * Insert a list of objects after an object with a given id.
   * Used by pixel eraser to replace one stroke with two sub-strokes.
   */
  replaceWithMany(id: string, replacements: DrawObject[]): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx !== -1) {
      this.objects.splice(idx, 1, ...replacements);
    }
  }

  /** Bulk replace the entire object list — used by undo/redo. */
  replaceAll(objects: DrawObject[]): void {
    this.objects = objects;
  }

  /** Remove every object — used on document load to start fresh. */
  clear(): void {
    this.objects = [];
  }
}
