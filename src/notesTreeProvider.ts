import * as vscode from "vscode";
import * as path from "path";
import { NoteStore } from "./noteStore";
import { CodeNote } from "./types";

type TreeItemData =
  | { kind: "file"; filePath: string; folder: vscode.WorkspaceFolder; count: number }
  | { kind: "note"; note: CodeNote; folder: vscode.WorkspaceFolder };

export class NotesTreeProvider implements vscode.TreeDataProvider<TreeItemData> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: NoteStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItemData): vscode.TreeItem {
    if (element.kind === "file") {
      const item = new vscode.TreeItem(element.filePath, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${element.count} note${element.count === 1 ? "" : "s"}`;
      item.iconPath = new vscode.ThemeIcon("file-code");
      item.contextValue = "codenotesFile";
      return item;
    }

    const { note } = element;
    const firstLine = note.note.split("\n").find((l) => l.trim().length > 0) ?? "(empty note)";
    const item = new vscode.TreeItem(firstLine.slice(0, 80), vscode.TreeItemCollapsibleState.None);
    item.description = note.orphaned ? `⚠ line ${note.line + 1} (unresolved)` : `line ${note.line + 1}`;
    item.iconPath = new vscode.ThemeIcon(note.orphaned ? "warning" : "note");
    item.contextValue = "codenotesNote";
    item.command = {
      command: "codenotes.revealNote",
      title: "Reveal Note",
      arguments: [note.id],
    };
    item.tooltip = new vscode.MarkdownString(note.note);
    return item;
  }

  getChildren(element?: TreeItemData): vscode.ProviderResult<TreeItemData[]> {
    if (!element) {
      const byFile = new Map<string, { folder: vscode.WorkspaceFolder; count: number }>();
      for (const { note, folder } of this.store.getAllNotes()) {
        const key = `${folder.uri.toString()}::${note.filePath}`;
        const existing = byFile.get(key);
        if (existing) {
          existing.count++;
        } else {
          byFile.set(key, { folder, count: 1 });
        }
      }
      return Array.from(byFile.entries())
        .map(([key, val]) => ({
          kind: "file" as const,
          filePath: key.split("::")[1],
          folder: val.folder,
          count: val.count,
        }))
        .sort((a, b) => a.filePath.localeCompare(b.filePath));
    }

    if (element.kind === "file") {
      return this.store
        .getAllNotes()
        .filter((n) => n.note.filePath === element.filePath && n.folder.uri.toString() === element.folder.uri.toString())
        .map((n) => ({ kind: "note" as const, note: n.note, folder: n.folder }))
        .sort((a, b) => a.note.line - b.note.line);
    }

    return [];
  }
}

export function pathBasename(p: string): string {
  return path.basename(p);
}
