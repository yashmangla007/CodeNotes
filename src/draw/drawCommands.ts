// ---------------------------------------------------------------------------
// drawCommands.ts — Toggle command + Draw Mode registration
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import { DrawCustomEditorProvider } from "./drawCustomEditorProvider";
import { DrawStore } from "./drawStore";

/**
 * Register the Draw Mode custom editor provider and toggle command.
 * Called from extension.ts activate().
 */
export function registerDrawMode(
  context: vscode.ExtensionContext,
  drawStore: DrawStore
): void {
  const provider = new DrawCustomEditorProvider(context.extensionUri, drawStore);

  // Register the custom editor provider (readonly)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DrawCustomEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        // Do not claim to support untitled documents
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // Register the toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("codenotes.draw.toggle", async () => {
      // 1. Determine the active text editor's file
      const editor = vscode.window.activeTextEditor;

      if (!editor || editor.document.uri.scheme !== "file") {
        // If no file-based editor is active, check if a Draw Mode tab is
        // focused — this lets the user toggle off from within Draw Mode.
        // We look for the active tab to figure out the URI.
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab?.input && typeof activeTab.input === "object") {
          const input = activeTab.input as { uri?: vscode.Uri; viewType?: string };
          if (
            input.viewType === DrawCustomEditorProvider.viewType &&
            input.uri
          ) {
            provider.close(input.uri);
            return;
          }
        }

        vscode.window.showInformationMessage(
          "CodeNotes: open a file first to enter Draw Mode."
        );
        return;
      }

      const uri = editor.document.uri;

      // 2. If Draw Mode is already open for this file, close it
      if (provider.isOpen(uri)) {
        provider.close(uri);
        return;
      }

      // 3. Capture the current scroll position (topmost visible line)
      const initialScrollLine =
        editor.visibleRanges.length > 0
          ? editor.visibleRanges[0].start.line
          : 0;

      // Store the scroll line so the provider can use it in resolveCustomEditor
      provider.setInitialScrollLine(uri, initialScrollLine);

      // 4. Open the custom editor
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        DrawCustomEditorProvider.viewType
      );
    })
  );
}
