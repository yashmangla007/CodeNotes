import * as vscode from "vscode";
import { NoteStore } from "./noteStore";
import { resolveNoteLine, makeAnchorText } from "./anchor";

export class DecorationManager implements vscode.Disposable {
  private readonly noteDecoration: vscode.TextEditorDecorationType;
  private readonly orphanedDecoration: vscode.TextEditorDecorationType;
  private visible = true;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext, private store: NoteStore) {
    this.noteDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: context.asAbsolutePath("media/note-icon.svg"),
      gutterIconSize: "contain",
      isWholeLine: false,
      overviewRulerColor: "#E3B341",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.orphanedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: context.asAbsolutePath("media/note-icon-orphaned.svg"),
      gutterIconSize: "contain",
      isWholeLine: false,
      overviewRulerColor: "#8a8a8a",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (ed) {
          this.reanchorAndRender(ed);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
        if (editor) {
          this.reanchorAndRender(editor);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
        if (editor) {
          this.reanchorAndRender(editor);
        }
      }),
      this.store.onDidChange(() => {
        for (const editor of vscode.window.visibleTextEditors) {
          this.reanchorAndRender(editor);
        }
      })
    );
  }

  toggleVisibility(): boolean {
    this.visible = !this.visible;
    for (const editor of vscode.window.visibleTextEditors) {
      this.render(editor);
    }
    return this.visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  renderAllVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.reanchorAndRender(editor);
    }
  }

  /** Re-resolve every note's line for this document, persist any moves, then render decorations. */
  reanchorAndRender(editor: vscode.TextEditor): void {
    const config = vscode.workspace.getConfiguration("codenotes");
    const window = config.get<number>("anchorSearchWindow", 60);
    const notes = this.store.getNotesForDocument(editor.document.uri);

    for (const note of notes) {
      const result = resolveNoteLine(editor.document, note, window);
      if (result.line !== null) {
        const newAnchor = makeAnchorText(editor.document.lineAt(result.line).text);
        this.store.updateNotePosition(note.id, result.line, newAnchor, false);
      } else {
        this.store.updateNotePosition(note.id, note.line, note.anchorText, true);
      }
    }

    this.render(editor);
  }

  private render(editor: vscode.TextEditor): void {
    const showGutter = vscode.workspace.getConfiguration("codenotes").get<boolean>("showGutterIcon", true);
    if (!this.visible || !showGutter) {
      editor.setDecorations(this.noteDecoration, []);
      editor.setDecorations(this.orphanedDecoration, []);
      return;
    }

    const notes = this.store.getNotesForDocument(editor.document.uri);
    const okRanges: vscode.Range[] = [];
    const orphanedRanges: vscode.Range[] = [];

    for (const note of notes) {
      if (note.orphaned) {
        // Orphaned notes have no reliable line — skip decorating in-editor;
        // they still show up in the CodeNotes sidebar for manual re-linking.
        continue;
      }
      if (note.line >= 0 && note.line < editor.document.lineCount) {
        okRanges.push(new vscode.Range(note.line, 0, note.line, 0));
      }
    }

    editor.setDecorations(this.noteDecoration, okRanges);
    editor.setDecorations(this.orphanedDecoration, orphanedRanges);
  }

  dispose(): void {
    this.noteDecoration.dispose();
    this.orphanedDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
