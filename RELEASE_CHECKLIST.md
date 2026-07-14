# CodeNotes — Release Checklist

This checklist guides the release manager through final validation, compilation, packaging, and publishing of a new CodeNotes release.

---

## 1. Build Verification

- [ ] **Clean Worktree**
  - [ ] Ensure all local changes are committed or stashed: `git status`
  - [ ] Check that no untracked developer files or logs are present.
- [ ] **Clean Build Output**
  - [ ] Remove the previous build outputs:
    - On Windows (PowerShell): `Remove-Item -Recurse -Force out`
    - On macOS/Linux: `rm -rf out`
- [ ] **Package Installation Verification**
  - [ ] Perform a clean package install: `npm ci` (inside the `codenotes-extension` directory).
- [ ] **Production Compile**
  - [ ] Compile the Extension Host and Webview: `npm run compile`
  - [ ] Verify that no TypeScript compilation errors exist.
  - [ ] Verify that the esbuild webview bundle compiles successfully to `out/webview/main.js`.

---

## 2. Manual Testing

Run the extension inside the **Extension Development Host** (F5) and complete the following verification matrix:

### Hover Notes
- [ ] **Core Creation & Layout**
  - [ ] Create a note using `Ctrl+Alt+N` / `Cmd+Alt+N`. Verify the gutter icon appears.
  - [ ] Hover over the line; verify the Markdown renders correctly in the tooltip.
- [ ] **Editing & Saving**
  - [ ] Edit a note via the side panel using `Ctrl+Alt+E` / `Cmd+Alt+E`.
  - [ ] Verify writing list elements and code blocks saves correctly (`Ctrl+S`).
- [ ] **Anchoring & Re-anchoring**
  - [ ] Insert new lines of code above the annotated line. Save the file.
  - [ ] Verify the note's gutter icon moves to remain aligned with the target code text.
  - [ ] Edit the anchor text. Confirm the note becomes marked as **Orphaned** (yellow warning icon in the sidebar).
- [ ] **Visibility Toggling**
  - [ ] Press `Ctrl+Alt+H` / `Cmd+Alt+H` to hide note indicators.
  - [ ] Verify that notes are hidden on screen but still present in the sidebar. Toggle them back on.

### Draw Mode
- [ ] **Toggle & Scroll Alignment**
  - [ ] Toggle Draw Mode on a file using `Ctrl+Alt+D` / `Cmd+Alt+D`.
  - [ ] Confirm the custom editor viewport aligns perfectly with the scroll position of the previous editor.
- [ ] **Pen & Pressure Sensitivity**
  - [ ] Select the **Pen** tool and draw multiple strokes.
  - [ ] If using a stylus pen, verify stroke width varies dynamically with pressure.
- [ ] **Palm Rejection**
  - [ ] While drawing with a pen, rest your hand or touch the canvas with a finger.
  - [ ] Verify that touch inputs do not create accidental shapes, strokes, or text boxes.
- [ ] **Shapes & Snapping**
  - [ ] Select the **Shape** tool and draw lines, arrows, rectangles, and ellipses.
  - [ ] Hold **Shift** while drawing. Verify constraints snap to 45-degree angles, perfect squares, and perfect circles.
- [ ] **Text Annotations**
  - [ ] Select the **Text** tool, click, and create text.
  - [ ] Verify that typing shortcuts are captured locally and do not trigger parent VS Code commands.
  - [ ] Use `Ctrl+Enter` to commit, and double-click to re-edit.
- [ ] **Eraser Modes**
  - [ ] Toggle to **Stroke Eraser**; verify touching a stroke deletes it entirely.
  - [ ] Toggle to **Pixel Eraser**; verify drawing through a stroke splits it into two distinct pieces.
- [ ] **Images & Scaling**
  - [ ] Paste (`Ctrl+V`) or drag-and-drop an image wider than 2000px.
  - [ ] Verify the image scales down, saves under `.codenotes/drawings/assets/`, and is fully resizable/movable.
- [ ] **Undo & Redo History**
  - [ ] Draw/erase objects, and verify `Ctrl+Z` and `Ctrl+Shift+Z`/`Ctrl+Y` traverse the stack correctly.
- [ ] **Layers Manager**
  - [ ] Create a new layer, draw objects, and toggle visibility.
  - [ ] Verify that hidden layer objects are omitted from selection tests and drawings.
- [ ] **Zoom Consistency**
  - [ ] Use `Ctrl+Scroll` or buttons to zoom. Verify code text and drawings scale and remain aligned.
- [ ] **Persistence & Autosave**
  - [ ] Draw a stroke, wait, and verify `.codenotes/drawings/drawings.json` is updated.
  - [ ] Close the tab. Reopen Draw Mode and confirm all drawings restore to the exact layout.

---

## 3. Packaging

- [ ] **Manifest Consistency**
  - [ ] Confirm `"version"` in `codenotes-extension/package.json` is correct and matches the target release.
  - [ ] Confirm `"publisher"` and extension description fields are set.
- [ ] **Extension Ignored Files check**
  - [ ] Inspect `.vscodeignore` to ensure it excludes development dependencies:
    - [ ] `src/` (excluding compiled outputs)
    - [ ] `tsconfig.json`
    - [ ] `.gitignore`
    - [ ] Node modules folders (`node_modules/`)
- [ ] **Build VSIX**
  - [ ] Package the extension: `npx @vscode/vsce package`
  - [ ] Confirm the generated `codenotes-<version>.vsix` file matches the expected target version.

---

## 4. VSIX Installation

- [ ] **Uninstall Pre-existing Builds**
  - [ ] Remove older development copies to avoid cache collision.
- [ ] **Local Permanent Install**
  - [ ] Run: `code --install-extension codenotes-<version>.vsix`
  - [ ] Restart VS Code.
- [ ] **Clean Sandbox Verification**
  - [ ] Create a new dummy workspace folder.
  - [ ] Test Hover Notes and Draw Mode one last time using only the packaged extension.
  - [ ] Verify no development assets are missing from the build.

---

## 5. Documentation Review

- [ ] **Changelog Sync**
  - [ ] Ensure `CHANGELOG.md` lists the current release version, date, and has all new features listed under `### Added`.
- [ ] **Readme Accuracy**
  - [ ] Review `README.md` to ensure all keybindings, configurations, and installation scripts match current release behavior.
- [ ] **Guides Validation**
  - [ ] Check `INSTALLATION_GUIDE.md` and `USER_GUIDE.md` for typo corrections or outdated commands.

---

## 6. GitHub Release

- [ ] **Push Release Tag**
  - [ ] Tag the final commit: `git tag -a v<version> -m "Release v<version>"`
  - [ ] Push the tags to GitHub: `git push origin v<version>`
- [ ] **Draft GitHub Release**
  - [ ] Navigate to the repository's Release page.
  - [ ] Set tag version as `v<version>` and title it `Release v<version>`.
  - [ ] Copy the changelog section for the version into the Release description.
- [ ] **Attach Assets**
  - [ ] Attach the compiled `codenotes-<version>.vsix` file to the release assets block.
- [ ] **Publish Release**
  - [ ] Click **Publish release**.

---

## 7. Final Validation

- [ ] **External Download Check**
  - [ ] Download the attached `.vsix` from the published GitHub release.
  - [ ] Install it on a separate machine (or container) running VS Code.
  - [ ] Confirm the extension activates and operates with no missing assets.
