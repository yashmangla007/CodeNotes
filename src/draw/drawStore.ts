// ---------------------------------------------------------------------------
// drawStore.ts — Persistence manager for drawings on disk
// Stores drawings under .codenotes/drawings/drawings.json per workspace folder.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "path";
import type { FileDrawingDocument } from "./drawTypes";

const STORE_DIR = ".codenotes";
const DRAWINGS_DIR = "drawings";
const STORE_FILE = "drawings.json";

interface DrawingsFile {
  version: 1;
  files: Record<string, FileDrawingDocument>;
}

export class DrawStore implements vscode.Disposable {
  // Map from workspace folder URI string -> map from relative path -> document
  private drawingsByFolder: Map<string, Map<string, FileDrawingDocument>> = new Map();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private saveTimers: Map<string, NodeJS.Timeout> = new Map();

  /** Callback fired when a save fails, so the editor can surface the error in the webview */
  public onSaveError: ((error: string) => void) | null = null;
  /** Callback fired when a save succeeds */
  public onSaveSuccess: (() => void) | null = null;

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
    return vscode.Uri.joinPath(folder.uri, STORE_DIR, DRAWINGS_DIR, STORE_FILE);
  }

  private async loadFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    const uri = this.storeUri(folder);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed: DrawingsFile = JSON.parse(Buffer.from(bytes).toString("utf8"));
      
      const fileMap = new Map<string, FileDrawingDocument>();
      if (parsed.files) {
        for (const [relPath, doc] of Object.entries(parsed.files)) {
          fileMap.set(relPath, doc);
        }
      }
      this.drawingsByFolder.set(folder.uri.toString(), fileMap);
    } catch {
      // No drawings file yet for this folder — start empty.
      this.drawingsByFolder.set(folder.uri.toString(), new Map());
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
    }, 500); // Debounce matching TRD §6.5
    this.saveTimers.set(key, timer);
  }

  private async persist(folder: vscode.WorkspaceFolder): Promise<void> {
    const fileMap = this.drawingsByFolder.get(folder.uri.toString());
    if (!fileMap) {
      return;
    }

    const dirUri = vscode.Uri.joinPath(folder.uri, STORE_DIR, DRAWINGS_DIR);
    try {
      await vscode.workspace.fs.createDirectory(dirUri);
      
      const filesObj: Record<string, FileDrawingDocument> = {};
      for (const [relPath, doc] of fileMap.entries()) {
        filesObj[relPath] = doc;
      }

      const payload: DrawingsFile = { version: 1, files: filesObj };
      const bytes = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
      await vscode.workspace.fs.writeFile(this.storeUri(folder), bytes);
      this.onSaveSuccess?.();
    } catch (err) {
      const errorMsg = `CodeNotes: failed to save drawings — ${String(err)}`;
      vscode.window.showErrorMessage(errorMsg);
      this.onSaveError?.(String(err));
    }
  }

  getDrawing(uri: vscode.Uri): FileDrawingDocument | null {
    const located = this.locate(uri);
    if (!located) {
      return null;
    }
    const fileMap = this.drawingsByFolder.get(located.folder.uri.toString());
    if (!fileMap) {
      return null;
    }
    return fileMap.get(located.relPath) ?? null;
  }

  updateDrawing(uri: vscode.Uri, doc: FileDrawingDocument): void {
    const located = this.locate(uri);
    if (!located) {
      vscode.window.showWarningMessage("CodeNotes: open the file inside a workspace folder to save drawings.");
      return;
    }

    // Ensure filePath matches located relative path
    doc.filePath = located.relPath;

    let fileMap = this.drawingsByFolder.get(located.folder.uri.toString());
    if (!fileMap) {
      fileMap = new Map();
      this.drawingsByFolder.set(located.folder.uri.toString(), fileMap);
    }

    fileMap.set(located.relPath, doc);
    this.scheduleSave(located.folder);
    this._onDidChange.fire(uri);
  }

  /** Force immediate save for a folder containing the given document URI, clearing any pending timer. */
  async forceSave(uri: vscode.Uri): Promise<void> {
    const located = this.locate(uri);
    if (!located) {
      return;
    }
    const key = located.folder.uri.toString();
    const existing = this.saveTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.saveTimers.delete(key);
    }
    await this.persist(located.folder);
  }

  dispose(): void {
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this._onDidChange.dispose();
  }
}
