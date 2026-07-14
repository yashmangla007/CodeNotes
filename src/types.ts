export interface CodeNote {
  id: string;
  /** Path relative to the workspace root, POSIX-style separators. */
  filePath: string;
  /** Last known 0-indexed line number. */
  line: number;
  /** Trimmed content of the line at the time the note was anchored (or last re-anchored). */
  anchorText: string;
  /** Markdown body of the note. */
  note: string;
  createdAt: string;
  updatedAt: string;
  /** True when the anchor text could not be found near the last known line. */
  orphaned?: boolean;
}

export interface NotesFile {
  version: 1;
  notes: CodeNote[];
}
