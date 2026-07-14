import * as vscode from "vscode";
import { CodeNote } from "./types";

const MAX_ANCHOR_LENGTH = 200;

/** Normalize a line of source into the snippet we compare against for anchoring. */
export function makeAnchorText(lineText: string): string {
  return lineText.trim().slice(0, MAX_ANCHOR_LENGTH);
}

export interface ResolveResult {
  line: number | null;
  /** True if the note's stored line no longer matches and had to be re-anchored (or failed to). */
  moved: boolean;
}

/**
 * Try to find the current line for a note.
 * 1. Check the last known line first (cheap path, true most of the time).
 * 2. Otherwise search outward in a growing radius within the configured window.
 * Empty/whitespace-only anchor text is never matched, to avoid every blank line
 * in the file "attracting" an orphaned note.
 */
export function resolveNoteLine(
  document: vscode.TextDocument,
  note: CodeNote,
  searchWindow: number
): ResolveResult {
  if (!note.anchorText) {
    return { line: null, moved: true };
  }

  const lineCount = document.lineCount;
  const lastKnown = Math.min(Math.max(note.line, 0), lineCount - 1);

  if (lastKnown < lineCount && document.lineAt(lastKnown).text.trim() === note.anchorText) {
    return { line: lastKnown, moved: false };
  }

  for (let offset = 1; offset <= searchWindow; offset++) {
    const below = lastKnown + offset;
    const above = lastKnown - offset;

    if (below < lineCount && document.lineAt(below).text.trim() === note.anchorText) {
      return { line: below, moved: true };
    }
    if (above >= 0 && document.lineAt(above).text.trim() === note.anchorText) {
      return { line: above, moved: true };
    }
  }

  return { line: null, moved: true };
}
