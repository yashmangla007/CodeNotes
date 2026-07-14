import * as vscode from "vscode";
import { NoteStore } from "./noteStore";

export class NoteHoverProvider implements vscode.HoverProvider {
  constructor(private store: NoteStore) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const notes = this.store.getNotesForDocument(document.uri);
    const note = notes.find((n) => !n.orphaned && n.line === position.line);
    if (!note) {
      return undefined;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.supportHtml = false;
    md.appendMarkdown(`**📝 CodeNotes**\n\n`);
    md.appendMarkdown(note.note);
    md.appendMarkdown(
      `\n\n---\n*Updated ${new Date(note.updatedAt).toLocaleString()} · [Edit](command:codenotes.editNote?${encodeURIComponent(
        JSON.stringify([note.id])
      )}) · [Delete](command:codenotes.deleteNote?${encodeURIComponent(JSON.stringify([note.id]))})*`
    );
    md.isTrusted = { enabledCommands: ["codenotes.editNote", "codenotes.deleteNote"] };

    return new vscode.Hover(md, document.lineAt(position.line).range);
  }
}
