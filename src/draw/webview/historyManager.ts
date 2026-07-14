// ---------------------------------------------------------------------------
// historyManager.ts — Undo/Redo history stack (Phase 5 refactor)
//
// Phase 5 change: snapshots are now DrawObject[] (the full unified object
// list) rather than the Phase 4 FinishedStroke[] sub-type.  Every action
// is a simple replace-all pair — no type discriminant needed.
// ---------------------------------------------------------------------------

import type { DrawObject, StrokeObject } from "../drawTypes";

export interface HistoryAction {
  before: DrawObject[];
  after: DrawObject[];
}

export class HistoryManager {
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];

  constructor(private readonly onStateChange: () => void) {}

  /** Record a new action on the stack and clear the redo stack. */
  pushAction(action: HistoryAction): void {
    // Only push if there's an actual difference (compare by first/last id or length)
    if (areSnapshotsEqual(action.before, action.after)) {
      return;
    }
    this.undoStack.push(action);
    this.redoStack = [];
    this.onStateChange();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Pop from undo stack, push to redo, return the action. */
  undo(): HistoryAction | null {
    const action = this.undoStack.pop();
    if (!action) return null;
    this.redoStack.push(action);
    this.onStateChange();
    return action;
  }

  /** Pop from redo stack, push to undo, return the action. */
  redo(): HistoryAction | null {
    const action = this.redoStack.pop();
    if (!action) return null;
    this.undoStack.push(action);
    this.onStateChange();
    return action;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onStateChange();
  }
}

/**
 * Cheap equality check: compare array length and all object IDs in order.
 * If IDs are the same in order but internal state changed (e.g. pixel erase
 * moved a point), we also check points length + color for stroke objects
 * to catch those mutations.
 */
function areSnapshotsEqual(a: DrawObject[], b: DrawObject[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].type !== b[i].type) return false;
    if (a[i].type === "stroke" && b[i].type === "stroke") {
      const strokeA = a[i] as StrokeObject;
      const strokeB = b[i] as StrokeObject;
      if (
        strokeA.points.length !== strokeB.points.length ||
        strokeA.color !== strokeB.color
      ) {
        return false;
      }
    }
  }
  return true;
}
