import * as vscode from "vscode";
import * as path from "path";
import { randomUUID } from "crypto";
import { CodeNote, NotesFile } from "./types";

const STORE_DIR = ".codenotes";
const STORE_FILE = "notes.json";

export class NoteStore implements vscode.Disposable {
  private notesByFolder: Map<string, CodeNote[]> = new Map();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private saveTimers: Map<string, NodeJS.Timeout> = new Map();

  async initialize(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    await Promise.all(folders.map((f) => this.loadFolder(f)));
  }

  /** Resolve which workspace folder a document belongs to, and its path relative to that folder. */
  private locate(uri: vscode.Uri): { folder: vscode.WorkspaceFolder; relPath: string } | null {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return null;
    }
    const relPath = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
    return { folder, relPath };
  }

  private storeUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, STORE_DIR, STORE_FILE);
  }

  private async loadFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    const uri = this.storeUri(folder);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed: NotesFile = JSON.parse(Buffer.from(bytes).toString("utf8"));
      this.notesByFolder.set(folder.uri.toString(), parsed.notes ?? []);
    } catch {
      // No notes file yet for this folder — that's fine, start empty.
      this.notesByFolder.set(folder.uri.toString(), []);
    }
  }

  private scheduleSave(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    const existing = this.saveTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.saveTimers.delete(key);
      void this.persist(folder);
    }, 300);
    this.saveTimers.set(key, timer);
  }

  private async persist(folder: vscode.WorkspaceFolder): Promise<void> {
    const notes = this.notesByFolder.get(folder.uri.toString()) ?? [];
    const dirUri = vscode.Uri.joinPath(folder.uri, STORE_DIR);
    try {
      await vscode.workspace.fs.createDirectory(dirUri);
      const payload: NotesFile = { version: 1, notes };
      const bytes = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
      await vscode.workspace.fs.writeFile(this.storeUri(folder), bytes);
    } catch (err) {
      vscode.window.showErrorMessage(`CodeNotes: failed to save notes — ${String(err)}`);
    }
  }

  getNotesForDocument(uri: vscode.Uri): CodeNote[] {
    const located = this.locate(uri);
    if (!located) {
      return [];
    }
    const all = this.notesByFolder.get(located.folder.uri.toString()) ?? [];
    return all.filter((n) => n.filePath === located.relPath);
  }

  getAllNotes(): { note: CodeNote; folder: vscode.WorkspaceFolder }[] {
    const result: { note: CodeNote; folder: vscode.WorkspaceFolder }[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const notes = this.notesByFolder.get(folder.uri.toString()) ?? [];
      for (const note of notes) {
        result.push({ note, folder });
      }
    }
    return result;
  }

  addNote(uri: vscode.Uri, line: number, anchorText: string, noteText: string): CodeNote | null {
    const located = this.locate(uri);
    if (!located) {
      vscode.window.showWarningMessage("CodeNotes: open the file inside a workspace folder to attach notes.");
      return null;
    }
    const now = new Date().toISOString();
    const note: CodeNote = {
      id: randomUUID(),
      filePath: located.relPath,
      line,
      anchorText,
      note: noteText,
      createdAt: now,
      updatedAt: now,
    };
    const list = this.notesByFolder.get(located.folder.uri.toString()) ?? [];
    list.push(note);
    this.notesByFolder.set(located.folder.uri.toString(), list);
    this.scheduleSave(located.folder);
    this._onDidChange.fire();
    return note;
  }

  updateNoteText(id: string, noteText: string): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const list = this.notesByFolder.get(folder.uri.toString());
      const found = list?.find((n) => n.id === id);
      if (found) {
        found.note = noteText;
        found.updatedAt = new Date().toISOString();
        this.scheduleSave(folder);
        this._onDidChange.fire();
        return;
      }
    }
  }

  /** Update a note's resolved position after successful re-anchoring, without touching noteText. */
  updateNotePosition(id: string, line: number, anchorText: string, orphaned: boolean): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const list = this.notesByFolder.get(folder.uri.toString());
      const found = list?.find((n) => n.id === id);
      if (found) {
        const changed = found.line !== line || found.orphaned !== orphaned;
        found.line = line;
        if (!orphaned) {
          found.anchorText = anchorText;
        }
        found.orphaned = orphaned;
        if (changed) {
          this.scheduleSave(folder);
        }
        return;
      }
    }
  }

  deleteNote(id: string): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const list = this.notesByFolder.get(folder.uri.toString());
      const idx = list?.findIndex((n) => n.id === id) ?? -1;
      if (list && idx >= 0) {
        list.splice(idx, 1);
        this.scheduleSave(folder);
        this._onDidChange.fire();
        return;
      }
    }
  }

  getNote(id: string): CodeNote | undefined {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const found = this.notesByFolder.get(folder.uri.toString())?.find((n) => n.id === id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  fireChanged(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this._onDidChange.dispose();
  }
}
