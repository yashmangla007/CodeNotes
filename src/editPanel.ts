import * as vscode from "vscode";
import { NoteStore } from "./noteStore";

export function openNoteEditor(context: vscode.ExtensionContext, store: NoteStore, noteId: string): void {
  const note = store.getNote(noteId);
  if (!note) {
    vscode.window.showWarningMessage("CodeNotes: note not found (it may have been deleted).");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "codenotesEdit",
    `CodeNotes: ${note.filePath}:${note.line + 1}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getHtml(panel.webview, note.note, note.filePath, note.line + 1);

  panel.webview.onDidReceiveMessage((message) => {
    if (message.type === "save") {
      store.updateNoteText(noteId, message.text);
      vscode.window.setStatusBarMessage("CodeNotes: note saved", 2000);
    } else if (message.type === "close") {
      panel.dispose();
    }
  });
}

function getHtml(webview: vscode.Webview, initialText: string, filePath: string, line: number): string {
  const escaped = initialText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    padding: 12px;
  }
  h2 { font-size: 13px; opacity: 0.75; margin-bottom: 8px; font-weight: 500; }
  textarea {
    width: 100%;
    height: 60vh;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    padding: 8px;
    resize: vertical;
  }
  .toolbar { margin-top: 10px; display: flex; gap: 8px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .hint { margin-top: 6px; font-size: 11px; opacity: 0.6; }
</style>
</head>
<body>
  <h2>📝 ${filePath}:${line} — Markdown supported</h2>
  <textarea id="editor">${escaped}</textarea>
  <div class="toolbar">
    <button id="save">Save (Ctrl/Cmd+S)</button>
    <button id="close" class="secondary">Close</button>
  </div>
  <div class="hint">Changes save to .codenotes/notes.json — your source file is never modified.</div>
  <script>
    const vscode = acquireVsCodeApi();
    const editor = document.getElementById('editor');
    function save() {
      vscode.postMessage({ type: 'save', text: editor.value });
    }
    document.getElementById('save').addEventListener('click', save);
    document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
  </script>
</body>
</html>`;
}
