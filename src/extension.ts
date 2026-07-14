import * as vscode from "vscode";
import { NoteStore } from "./noteStore";
import { DecorationManager } from "./decorationManager";
import { NoteHoverProvider } from "./hoverProvider";
import { NotesTreeProvider } from "./notesTreeProvider";
import { openNoteEditor } from "./editPanel";
import { makeAnchorText, resolveNoteLine } from "./anchor";
import { registerDrawMode } from "./draw/drawCommands";
import { DrawStore } from "./draw/drawStore";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new NoteStore();
  await store.initialize();

  const decorations = new DecorationManager(context, store);
  const treeProvider = new NotesTreeProvider(store);

  context.subscriptions.push(
    store,
    decorations,
    vscode.window.registerTreeDataProvider("codenotesExplorer", treeProvider),
    vscode.languages.registerHoverProvider({ scheme: "file" }, new NoteHoverProvider(store)),

    vscode.commands.registerCommand("codenotes.addNote", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("CodeNotes: open a file first.");
        return;
      }
      const line = editor.selection.active.line;
      const lineText = editor.document.lineAt(line).text;

      const existing = store.getNotesForDocument(editor.document.uri).find((n) => n.line === line && !n.orphaned);
      if (existing) {
        const choice = await vscode.window.showInformationMessage(
          "This line already has a CodeNote. Edit it instead?",
          "Edit",
          "Cancel"
        );
        if (choice === "Edit") {
          openNoteEditor(context, store, existing.id);
        }
        return;
      }

      const quickText = await vscode.window.showInputBox({
        prompt: `Add a note for line ${line + 1}`,
        placeHolder: "Quick note (you can expand to full Markdown afterwards with Edit Note)",
      });
      if (quickText === undefined) {
        return; // cancelled
      }

      const anchorText = makeAnchorText(lineText);
      const created = store.addNote(editor.document.uri, line, anchorText, quickText);
      if (created) {
        decorations.reanchorAndRender(editor);
      }
    }),

    vscode.commands.registerCommand("codenotes.editNote", async (noteId?: string) => {
      let id = noteId;
      if (!id) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const line = editor.selection.active.line;
        const note = store.getNotesForDocument(editor.document.uri).find((n) => n.line === line && !n.orphaned);
        if (!note) {
          vscode.window.showInformationMessage("CodeNotes: no note on this line. Use 'Add Note' first.");
          return;
        }
        id = note.id;
      }
      openNoteEditor(context, store, id);
    }),

    vscode.commands.registerCommand("codenotes.deleteNote", async (noteId?: string) => {
      let id = noteId;
      if (!id) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const line = editor.selection.active.line;
        const note = store.getNotesForDocument(editor.document.uri).find((n) => n.line === line && !n.orphaned);
        if (!note) {
          vscode.window.showInformationMessage("CodeNotes: no note on this line.");
          return;
        }
        id = note.id;
      }
      const confirm = await vscode.window.showWarningMessage("Delete this CodeNote?", { modal: true }, "Delete");
      if (confirm === "Delete") {
        store.deleteNote(id);
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          decorations.reanchorAndRender(editor);
        }
      }
    }),

    vscode.commands.registerCommand("codenotes.toggleVisibility", () => {
      const nowVisible = decorations.toggleVisibility();
      vscode.window.setStatusBarMessage(`CodeNotes: notes ${nowVisible ? "shown" : "hidden"}`, 2000);
    }),

    vscode.commands.registerCommand("codenotes.refreshTree", () => treeProvider.refresh()),

    vscode.commands.registerCommand("codenotes.revealNote", async (noteId: string) => {
      const note = store.getNote(noteId);
      if (!note) {
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.find((f) =>
        store.getAllNotes().some((n) => n.note.id === noteId && n.folder.uri.toString() === f.uri.toString())
      );
      if (!folder) {
        return;
      }
      const uri = vscode.Uri.joinPath(folder.uri, note.filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      const config = vscode.workspace.getConfiguration("codenotes");
      const window = config.get<number>("anchorSearchWindow", 60);
      const result = resolveNoteLine(document, note, window);
      const targetLine = result.line ?? note.line;

      const range = new vscode.Range(targetLine, 0, targetLine, 0);
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    })
  );

  const drawStore = new DrawStore();
  await drawStore.initialize();

  context.subscriptions.push(drawStore);

  decorations.renderAllVisibleEditors();

  // Draw Mode (Phase 1 scaffolding)
  registerDrawMode(context, drawStore);
}

export function deactivate(): void {
  // NoteStore and DecorationManager are disposed via context.subscriptions.
}
