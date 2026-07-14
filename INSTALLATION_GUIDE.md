# CodeNotes — Installation and Developer Setup Guide

This guide provides step-by-step instructions for setting up the development environment, building, packaging, installing, and troubleshooting the CodeNotes VS Code extension.

---

## Prerequisites

Before starting, ensure your system meets the following requirements:

- **Node.js**: Version `18.0.0` or higher (LTS recommended)
- **npm**: Version `9.0.0` or higher (installed automatically with Node.js)
- **VS Code**: Version `1.85.0` or higher
- **Operating System**: Windows, macOS, or Linux

---

## Developer Installation

To set up the project locally for development:

1. **Clone the Repository**
   Clone the repository to your local machine:
   ```bash
   git clone <repository-url>
   cd CodeNotes
   ```

2. **Navigate to the Extension Directory**
   The VS Code extension codebase is located in the `codenotes-extension` subdirectory:
   ```bash
   cd codenotes-extension
   ```

3. **Install Dependencies**
   Install all package and development dependencies:
   ```bash
   npm install
   ```
   This will install required runtime libraries such as `highlight.js` and `perfect-freehand`, along with TypeScript compiler and `esbuild` developer utilities.

---

## Building the Extension

CodeNotes is split into two distinct parts: the **Extension Host** (runs inside the VS Code node runtime) and the **Webview** (runs in VS Code's internal Chromium instance for Draw Mode). You must compile both components.

### 1. Complete Build (Host + Webview)
To compile both the host extension and bundle the webview code, run:
```bash
npm run compile
```
This script executes two compile commands in sequence:
- `npm run compile:host`: Compiles host TypeScript files (`src/*.ts`) into JavaScript in the `out/` directory using the TypeScript compiler (`tsc`).
- `npm run compile:webview`: Bundles the webview code (`src/draw/webview/main.ts`) into a single file at `out/webview/main.js` using `esbuild`.

### 2. Selective Builds (Incremental compilation)
If you are only editing specific parts of the project:
- **For Host only**: `npm run compile:host`
- **For Webview only**: `npm run compile:webview`

### 3. Watch Mode (Host only)
To automatically compile host TypeScript files as they are modified:
```bash
npm run watch
```
*Note: Watch mode does not monitor webview source files. Any changes under `src/draw/webview/` require a manual run of `npm run compile:webview`.*

---

## Running in the Extension Development Host

To run and debug the extension in an isolated VS Code environment:

1. Open the `codenotes-extension` folder in VS Code.
2. Press **F5** (or go to `Run and Debug` in the Activity Bar and click **Run Extension**).
3. VS Code will automatically run `npm run compile` to build the latest assets and launch a new window titled **[Extension Development Host]**.
4. Inside the new window, open any workspace folder and file.
5. Trigger commands via context menu, title bar button, or keyboard shortcuts to test changes (e.g. `Ctrl+Alt+N` for Hover Notes, `Ctrl+Alt+D` for Draw Mode).

---

## Packaging into a VSIX

To pack the extension into an installable `.vsix` file:

1. Ensure the project is compiled and up-to-date:
   ```bash
   npm run compile
   ```
2. Run the VS Code Extension packaging command using `npx` (which avoids needing to install the `vsce` CLI globally):
   ```bash
   npx @vscode/vsce package
   ```
3. This creates a package named `codenotes-0.1.0.vsix` in the root of the `codenotes-extension` directory.

---

## Installing Permanently

Once you have packaged the extension into a `.vsix` file, you can install it permanently into your local VS Code application:

### Method 1: Using the Command Line
Run the following command, specifying the path to your generated package:
```bash
code --install-extension codenotes-0.1.0.vsix
```

### Method 2: Using the VS Code User Interface
1. Open VS Code.
2. Open the **Extensions View** (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3. Click the `...` icon (Views and More Actions) in the top-right corner of the Extensions panel.
4. Select **Install from VSIX...** from the dropdown menu.
5. Locate and select the `codenotes-0.1.0.vsix` file.
6. Click **Install**. You may be prompted to reload the window.

---

## Updating the Extension

If you have made code updates and want to install the new version:

1. Increment the `"version"` field in `codenotes-extension/package.json` (e.g. from `0.1.0` to `0.1.1`).
2. Run the packaging command again:
   ```bash
   npx @vscode/vsce package
   ```
3. Re-install the new `.vsix` file using either Method 1 or Method 2. VS Code will replace the older version automatically and prompt for a reload.

---

## Uninstalling the Extension

To remove CodeNotes completely:

### Method 1: Using the VS Code User Interface
1. Open the **Extensions View** (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Search for "CodeNotes" in the search box.
3. Locate **CodeNotes — A Layer of Knowledge Over Your Code**.
4. Click the gear icon next to the extension name and click **Uninstall**.
5. Reload VS Code to complete the removal.

### Method 2: Using the Command Line
Run the following command:
```bash
code --uninstall-extension codenotes-dev.codenotes
```

---

## Troubleshooting

### 1. Webview load failure
- **Symptom**: Draw Mode opens as a blank dark tab and does not load drawings or the floating toolbar.
- **Root Cause**: The webview bundle (`out/webview/main.js`) might be missing or stale.
- **Solution**: Run `npm run compile:webview` to compile the esbuild bundle.

### 2. CSP (Content Security Policy) block warnings
- **Symptom**: Console logs show errors regarding resource loading policies blocking scripts or stylesheets.
- **Root Cause**: The webview enforces strict rules. Only the bundled `main.js` script with a cryptographically secure, single-use `nonce` is allowed to execute.
- **Solution**: Ensure your scripts are properly nonced and served locally. Images must be loaded via local URIs generated via `webview.asWebviewUri()` (pointing to assets under `.codenotes/drawings/assets/`). Remote files or external assets will be blocked by the CSP.

### 3. Save failure toast warning in Draw Mode
- **Symptom**: A red toast notification reading "Save failed: ..." appears in the bottom-center of the Draw Mode editor.
- **Root Cause**: CodeNotes cannot persist drawings when the active file is opened as a standalone file (outside a workspace folder), or write access to the `.codenotes/` directory is blocked.
- **Solution**: Ensure you have opened a folder workspace in VS Code before using CodeNotes. This allows the extension to resolve workspace folder bounds and write files successfully to `.codenotes/`.

### 4. Layout jitter during toolbar resizing
- **Symptom**: Viewport jumping when the toolbar wraps into multiple lines.
- **Root Cause**: The container padding shifts dynamically.
- **Solution**: Check that the CSS transitions in `#code-container` are properly functioning and smoothing the transition (`transition: padding-top 0.2s ease;`).

---

## Release Checklist

Before packaging a release version, perform these verification steps:

- [ ] **Verify Manifest version**: The version in `package.json` must be incremented.
- [ ] **Clean build**: Delete the `out/` directory and run a fresh `npm run compile` to confirm no compiler errors exist.
- [ ] **Verify dependencies**: Ensure no debug or experimental packages are left in the `dependencies` object.
- [ ] **Verify `.vscodeignore`**: Ensure source files (`src/**`), TypeScript configs (`tsconfig.json`), and build settings are ignored so they don't bloat the VSIX.
- [ ] **Run manual tests**:
  - Verify Hover Notes can be added, updated, and toggle hidden.
  - Verify Draw Mode works with pen, touch, and mouse input.
  - Verify palm rejection blocks touch inputs when a stylus pen is active.
  - Verify image copy-paste and drag-drop scale under 2000px and write correctly to the `.codenotes/drawings/assets/` directory.
  - Verify undo/redo stack functions correctly on shape placement and stroke drawing.
