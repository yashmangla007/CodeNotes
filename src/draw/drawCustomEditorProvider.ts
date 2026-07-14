// ---------------------------------------------------------------------------
// drawCustomEditorProvider.ts — VS Code Custom Readonly Editor Provider
// Opens a webview showing syntax-highlighted, read-only code for Draw Mode.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { DrawStore } from "./drawStore";
import type {
  FileDrawingDocument,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "./drawTypes";

/**
 * Tracks an open Draw Mode panel so the toggle command can find/close it.
 */
interface OpenPanel {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
  disposables: vscode.Disposable[];
}

export class DrawCustomEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public static readonly viewType = "codenotes.drawEditor";

  /** Map from file URI string → open panel info. */
  private readonly openPanels = new Map<string, OpenPanel>();

  /**
   * Pending initial scroll lines, keyed by URI string.
   * Set by the toggle command before opening the editor, consumed in
   * resolveCustomEditor.
   */
  private readonly pendingScrollLines = new Map<string, number>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly drawStore: DrawStore
  ) {}

  // ---- Public API for drawCommands.ts ------------------------------------

  /** Check whether a Draw Mode panel is open for the given URI. */
  isOpen(uri: vscode.Uri): boolean {
    return this.openPanels.has(uri.toString());
  }

  /** Close the Draw Mode panel for the given URI. */
  close(uri: vscode.Uri): void {
    const entry = this.openPanels.get(uri.toString());
    if (entry) {
      entry.panel.dispose(); // triggers onDidDispose → cleanup
    }
  }

  /** Store the scroll line the webview should jump to on init. */
  setInitialScrollLine(uri: vscode.Uri, line: number): void {
    this.pendingScrollLines.set(uri.toString(), line);
  }

  // ---- CustomReadonlyEditorProvider interface -----------------------------

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    // For a readonly provider the "document" is trivial — we just need
    // to return something that satisfies the interface and carries the URI.
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const uri = document.uri;
    const uriKey = uri.toString();

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
      ],
    };

    // Build and set HTML
    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview);

    // Track open panel
    const disposables: vscode.Disposable[] = [];
    const entry: OpenPanel = { panel: webviewPanel, uri, disposables };
    this.openPanels.set(uriKey, entry);

    // Clean up on close
    webviewPanel.onDidDispose(
      () => {
        this.openPanels.delete(uriKey);
        // Force save immediately on close (TRD §6.5)
        void this.drawStore.forceSave(uri);
        for (const d of disposables) {
          d.dispose();
        }
      },
      null,
      disposables
    );

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(
      async (msg: WebviewToHostMessage) => {
        switch (msg.type) {
          case "ready":
            await this.sendInit(webviewPanel.webview, uri);
            break;

          case "log":
            this.logFromWebview(msg.level, msg.message);
            break;

          case "documentChanged":
            this.drawStore.updateDrawing(uri, msg.document);
            break;

          case "requestImageImport":
            await this.handleImageImport(webviewPanel.webview, uri, msg);
            break;
        }
      },
      null,
      disposables
    );

    // ---- External edit detection (TRD §6.2) ------------------------------
    // Watch for changes to the underlying file while Draw Mode is open.
    // Send updated source code to the webview so it re-renders without
    // discarding existing drawn objects.
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === uriKey && e.contentChanges.length > 0) {
          const msg: HostToWebviewMessage = {
            type: "sourceChanged",
            sourceCode: e.document.getText(),
          };
          webviewPanel.webview.postMessage(msg);
        }
      })
    );

    // ---- Save-failure forwarding (TRD §9 rule 9) -------------------------
    // Surface save errors in the webview as a non-blocking toast.
    const previousOnSaveError = this.drawStore.onSaveError;
    this.drawStore.onSaveError = (error: string) => {
      const msg: HostToWebviewMessage = {
        type: "saveFailed",
        error,
      };
      webviewPanel.webview.postMessage(msg);
    };

    const previousOnSaveSuccess = this.drawStore.onSaveSuccess;
    this.drawStore.onSaveSuccess = () => {
      const msg: HostToWebviewMessage = {
        type: "saveSuccess",
      };
      webviewPanel.webview.postMessage(msg);
    };

    // Restore previous callbacks when panel is disposed
    disposables.push({
      dispose: () => {
        this.drawStore.onSaveError = previousOnSaveError;
        this.drawStore.onSaveSuccess = previousOnSaveSuccess;
      }
    });
  }

  // ---- Private helpers ---------------------------------------------------

  private async sendInit(
    webview: vscode.Webview,
    uri: vscode.Uri
  ): Promise<void> {
    const uriKey = uri.toString();

    // Read the source file
    let sourceCode: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      sourceCode = Buffer.from(bytes).toString("utf8");
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeNotes Draw Mode: failed to read file — ${String(err)}`
      );
      return;
    }

    // Determine language ID from the open text document, if available
    let languageId = "plaintext";
    const openDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uriKey
    );
    if (openDoc) {
      languageId = openDoc.languageId;
    }

    // Consume the pending scroll line (default to 0)
    const initialScrollLine = this.pendingScrollLines.get(uriKey) ?? 0;
    this.pendingScrollLines.delete(uriKey);

    // Load from DrawStore if it exists, otherwise fall back to a default empty doc
    let drawingDocument = this.drawStore.getDrawing(uri);
    if (!drawingDocument) {
      drawingDocument = {
        filePath: "",
        pageHeightLines: sourceCode.split("\n").length,
        layers: [
          {
            id: "default",
            name: "Default",
            visible: true,
            order: 0,
          },
        ],
        objects: [],
      };
    }

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    let baseAssetUri: string | undefined;
    if (folder) {
      const assetsDirUri = vscode.Uri.joinPath(
        folder.uri,
        ".codenotes",
        "drawings",
        "assets"
      );
      baseAssetUri = webview.asWebviewUri(assetsDirUri).toString();
    }

    const msg: HostToWebviewMessage = {
      type: "init",
      document: drawingDocument,
      sourceCode,
      languageId,
      initialScrollLine,
      baseAssetUri,
    };

    webview.postMessage(msg);
  }

  private async handleImageImport(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    msg: { dataUrl: string; suggestedExt: string; width: number; height: number; x?: number; y?: number }
  ): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (!folder) {
      vscode.window.showErrorMessage(
        "CodeNotes Draw Mode: cannot import image outside a workspace folder."
      );
      return;
    }

    try {
      // Parse the dataUrl
      const matches = msg.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error("Invalid image data URL format.");
      }
      const dataBuffer = Buffer.from(matches[2], "base64");

      // Ensure drawings and assets directories exist
      const assetsDirUri = vscode.Uri.joinPath(
        folder.uri,
        ".codenotes",
        "drawings",
        "assets"
      );
      await vscode.workspace.fs.createDirectory(assetsDirUri);

      // Generate filename
      const uuid = randomUUID();
      const filename = `${uuid}.${msg.suggestedExt}`;
      const assetFileUri = vscode.Uri.joinPath(assetsDirUri, filename);

      // Save to disk
      await vscode.workspace.fs.writeFile(assetFileUri, dataBuffer);

      // Get webview URI and relative path
      const webviewUri = webview.asWebviewUri(assetFileUri).toString();
      const assetPath = filename; // relative path under .codenotes/drawings/assets/

      // Send confirmation message to webview
      webview.postMessage({
        type: "imageImported",
        assetPath,
        webviewUri,
        width: msg.width,
        height: msg.height,
        x: msg.x,
        y: msg.y,
      } as HostToWebviewMessage);
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeNotes Draw Mode: failed to import image — ${String(err)}`
      );
    }
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    // Nonce for CSP
    const nonce = getNonce();

    // URI to the bundled webview script
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "main.js")
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none';">
  <title>CodeNotes — Draw Mode</title>
  <style>
    /* ---- Reset & base ---- */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      height: 100%;
      overflow: hidden;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: 'Consolas', 'Courier New', 'Droid Sans Mono', monospace;
      font-size: 13px;
      /* Prevent OS from claiming touch/pen input before Pointer Events fire */
      touch-action: none;
    }

    /* ---- Code container (scrollable, relative so canvas-host anchors to it) ---- */
    #code-container {
      position: relative;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      overflow-x: auto;
      padding: 8px 0;
      font-size: calc(13px * var(--zoom-scale, 1.0));
    }

    /* ---- Per-line layout ---- */
    .code-line {
      display: flex;
      white-space: pre;
      padding: 0 16px 0 0;
    }

    .line-gutter {
      display: inline-block;
      min-width: 3em;
      padding: 0 12px 0 16px;
      text-align: right;
      color: #858585;
      user-select: none;
      flex-shrink: 0;
    }

    .line-content {
      flex: 1;
      padding-left: 4px;
    }

    /* ---- Scrollbar styling ---- */
    #code-container::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    #code-container::-webkit-scrollbar-track {
      background: #1e1e1e;
    }
    #code-container::-webkit-scrollbar-thumb {
      background: #424242;
      border-radius: 5px;
    }
    #code-container::-webkit-scrollbar-thumb:hover {
      background: #555;
    }

    /* ---- highlight.js VS Code Dark theme (subset) ---- */
    .hljs {
      color: #d4d4d4;
      background: #1e1e1e;
    }
    .hljs-keyword,
    .hljs-selector-tag,
    .hljs-literal,
    .hljs-section,
    .hljs-link {
      color: #569cd6;
    }
    .hljs-function .hljs-keyword {
      color: #569cd6;
    }
    .hljs-string,
    .hljs-meta .hljs-string {
      color: #ce9178;
    }
    .hljs-number,
    .hljs-symbol,
    .hljs-bullet {
      color: #b5cea8;
    }
    .hljs-title,
    .hljs-title.function_,
    .hljs-title.class_ {
      color: #dcdcaa;
    }
    .hljs-params {
      color: #d4d4d4;
    }
    .hljs-comment,
    .hljs-quote {
      color: #6a9955;
      font-style: italic;
    }
    .hljs-doctag {
      color: #608b4e;
    }
    .hljs-meta,
    .hljs-meta .hljs-keyword,
    .hljs-tag {
      color: #569cd6;
    }
    .hljs-variable,
    .hljs-template-variable {
      color: #9cdcfe;
    }
    .hljs-attr,
    .hljs-attribute {
      color: #9cdcfe;
    }
    .hljs-type,
    .hljs-built_in,
    .hljs-class .hljs-title {
      color: #4ec9b0;
    }
    .hljs-regexp {
      color: #d16969;
    }
    .hljs-addition {
      color: #b5cea8;
    }
    .hljs-deletion {
      color: #ce9178;
    }
    .hljs-selector-attr,
    .hljs-selector-pseudo,
    .hljs-selector-id,
    .hljs-selector-class {
      color: #d7ba7d;
    }
    .hljs-template-tag {
      color: #d4d4d4;
    }
    .hljs-diff-addition {
      color: #b5cea8;
      background: #37421f;
    }
    .hljs-diff-deletion {
      color: #ce9178;
      background: #6e3333;
    }

    /* ---- Floating Draw Mode UI chrome ---- */
    #draw-ui-container {
      position: fixed;
      top: 12px;
      left: 12px;
      right: 12px;
      z-index: 100;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      gap: 12px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }

    /* Toolbar: centered, compact, max-width constrained */
    #toolbar {
      display: flex;
      flex-direction: column;
      gap: 0;
      background: rgba(28, 28, 32, 0.92);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 10px;
      padding: 6px;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.4),
        0 10px 30px -5px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
      pointer-events: auto;
      user-select: none;
      flex: 0 1 auto;
      min-width: 0;
      max-width: 700px;
    }

    .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      align-items: center;
      padding: 2px;
    }

    .toolbar-row + .toolbar-row {
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      margin-top: 2px;
      padding-top: 4px;
    }

    .toolbar-group {
      display: flex;
      gap: 2px;
      align-items: center;
    }

    /* Tool buttons: icon-sized square targets with tooltip */
    .tool-btn {
      position: relative;
      background: transparent;
      border: 1px solid transparent;
      color: rgba(200, 200, 210, 0.7);
      width: 32px;
      height: 32px;
      border-radius: 6px;
      cursor: pointer;
      outline: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
      flex-shrink: 0;
    }

    .tool-btn svg {
      width: 16px;
      height: 16px;
      display: block;
      flex-shrink: 0;
      stroke-width: 1.75;
      transition: opacity 0.15s ease;
    }

    .tool-btn:hover:not(:disabled) {
      color: rgba(230, 230, 240, 1);
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.10);
    }

    .tool-btn:active:not(:disabled) {
      transform: scale(0.92);
      background: rgba(255, 255, 255, 0.05);
    }

    .tool-btn.active {
      background: rgba(99, 179, 237, 0.18);
      border-color: rgba(99, 179, 237, 0.35);
      color: rgba(147, 210, 255, 1);
    }

    .tool-btn.active svg {
      opacity: 1;
    }

    .tool-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* Action buttons (undo/redo/zoom): slightly wider, same height */
    .action-btn {
      position: relative;
      background: transparent;
      border: 1px solid transparent;
      color: rgba(200, 200, 210, 0.7);
      height: 32px;
      min-width: 32px;
      padding: 0 8px;
      border-radius: 6px;
      cursor: pointer;
      outline: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
    }

    .action-btn svg {
      width: 15px;
      height: 15px;
      display: block;
      flex-shrink: 0;
      stroke-width: 1.75;
    }

    .action-btn:hover:not(:disabled) {
      color: rgba(230, 230, 240, 1);
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.10);
    }

    .action-btn:active:not(:disabled) {
      transform: scale(0.94);
    }

    .action-btn.active {
      background: rgba(99, 179, 237, 0.18);
      border-color: rgba(99, 179, 237, 0.35);
      color: rgba(147, 210, 255, 1);
    }

    .action-btn:disabled {
      opacity: 0.28;
      cursor: not-allowed;
    }

    /* Tooltip system */
    .tool-btn[data-tip]::after,
    .action-btn[data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      top: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(22, 22, 26, 0.96);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(220, 220, 230, 0.95);
      font-size: 10px;
      font-weight: 500;
      white-space: nowrap;
      padding: 3px 7px;
      border-radius: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 200;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    .tool-btn[data-tip]:hover::after,
    .action-btn[data-tip]:hover::after {
      opacity: 1;
    }

    .toolbar-separator {
      width: 1px;
      height: 20px;
      background: rgba(255, 255, 255, 0.10);
      margin: 0 3px;
      flex-shrink: 0;
      border-radius: 1px;
    }

    /* ---- Color swatches ---- */
    .color-palette {
      display: flex;
      gap: 5px;
      align-items: center;
      padding: 0 3px;
    }

    .color-swatch {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      cursor: pointer;
      border: 1.5px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      flex-shrink: 0;
    }

    .color-swatch:hover {
      transform: scale(1.2);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .color-swatch.active {
      border-color: #ffffff;
      transform: scale(1.15);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.25), 0 1px 4px rgba(0,0,0,0.5);
    }

    /* Zoom label */
    #zoom-label {
      color: rgba(200, 200, 215, 0.9);
      font-size: 11px;
      font-weight: 600;
      min-width: 34px;
      text-align: center;
      cursor: pointer;
      letter-spacing: 0.02em;
      padding: 0 2px;
    }

    /* Width buttons text labels */
    .width-label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
    }

    .width-dot {
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
    }

    /* Bold button */
    .btn-bold-text {
      font-weight: 700;
      font-size: 13px;
      font-family: Georgia, serif;
      letter-spacing: -0.02em;
    }

    /* Font size label */
    .font-size-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    /* ---- Layers Panel ---- */
    #layers-panel {
      width: 200px;
      flex-shrink: 0;
      background: rgba(28, 28, 32, 0.92);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 10px;
      padding: 10px;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.4),
        0 10px 30px -5px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: auto;
      user-select: none;
      color: rgba(220, 220, 230, 0.9);
    }

    .layers-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      padding-bottom: 7px;
    }

    .layers-title {
      font-weight: 600;
      font-size: 11px;
      color: rgba(200, 200, 215, 0.8);
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .layers-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 240px;
      overflow-y: auto;
    }

    .layer-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 6px;
      border-radius: 5px;
      border: 1px solid transparent;
      cursor: pointer;
      font-size: 11px;
      transition: background 0.12s ease, border-color 0.12s ease;
    }

    .layer-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .layer-item.active {
      background: rgba(99, 179, 237, 0.12);
      border-color: rgba(99, 179, 237, 0.25);
    }

    .layer-left {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-grow: 1;
      min-width: 0;
    }

    .layer-vis-btn {
      cursor: pointer;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.5;
      transition: opacity 0.15s ease;
      flex-shrink: 0;
    }

    .layer-vis-btn svg {
      width: 12px;
      height: 12px;
      stroke-width: 1.75;
    }

    .layer-vis-btn:hover {
      opacity: 1;
    }

    .layer-name {
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;
      flex-grow: 1;
      font-size: 11px;
      color: rgba(210, 210, 225, 0.9);
    }

    .layer-input {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.20);
      color: rgba(220, 220, 235, 1);
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: inherit;
      width: 80px;
      outline: none;
      transition: border-color 0.15s ease;
    }

    .layer-input:focus {
      border-color: rgba(99, 179, 237, 0.5);
    }

    /* ---- Toast notification (save-failure, TRD §9 rule 9) ---- */
    #toast-container {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      pointer-events: auto;
      background: rgba(200, 50, 50, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      transform: translateY(12px);
      max-width: 480px;
      text-align: center;
    }

    .toast.visible {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <div id="code-container"></div>
  <div id="toast-container"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private logFromWebview(
    level: "info" | "warn" | "error",
    message: string
  ): void {
    const prefix = "[CodeNotes Draw Webview]";
    switch (level) {
      case "info":
        console.log(prefix, message);
        break;
      case "warn":
        console.warn(prefix, message);
        break;
      case "error":
        console.error(prefix, message);
        break;
    }
  }
}

// ---- Utilities -----------------------------------------------------------

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
