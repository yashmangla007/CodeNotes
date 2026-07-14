# CodeNotes — A Layer of Knowledge Over Your Code

Attach Markdown notes to any line of code. Your source files are never modified —
notes live in `.codenotes/notes.json` inside your workspace and stay attached to
the right line even as the file changes above or below it.

This is a **working v0.1 MVP**: hover notes + line-based content anchoring +
separate storage + a sidebar notes list. The drawing layer and AI-assisted notes
described in the original pitch are **not** in this build (see "What's not here" below) —
they need their own dedicated design work, per the earlier analysis of this idea.

## Features in this build

- **Add a note** — right-click a line → `CodeNotes: Add Note`, or `Ctrl+Alt+N` / `Cmd+Alt+N`
- **Hover to read** — hover any annotated line to see the rendered Markdown, with inline Edit/Delete links
- **Edit as Markdown** — right-click → `CodeNotes: Edit Note (Markdown)`, or `Ctrl+Alt+E`, opens a side panel with a textarea (Ctrl/Cmd+S to save)
- **Delete a note** — right-click → `CodeNotes: Delete Note`
- **Toggle visibility** — `Ctrl+Alt+H` hides/shows all note decorations without deleting anything (teaching/revision mode)
- **Sidebar** — "CodeNotes" panel in the Explorer lists every note in the workspace, grouped by file; click one to jump to it
- **Content-based anchoring** — each note stores a snippet of the line it was attached to. If the line number shifts (you added code above it, reformatted, etc.), CodeNotes searches a window of nearby lines for that same text and re-attaches automatically. If it truly can't find a match, the note is marked **orphaned** (⚠ in the sidebar) instead of silently attaching to the wrong line.

## Try it

```bash
npm install
npm run compile
```

Then press **F5** in VS Code (with this folder open) to launch an Extension
Development Host. Open any file, right-click a line, and choose
**CodeNotes: Add Note**.

To build an installable package:

```bash
npm install -g @vscode/vsce
vsce package
```

This produces a `.vsix` you can install via `Extensions: Install from VSIX...`.

## How anchoring works (and its limits)

Each note stores the trimmed text of the line it was attached to (`anchorText`)
alongside the last known line number. On file open/save, CodeNotes:

1. Checks if the last known line still has matching content.
2. If not, searches outward (default ±60 lines, configurable via
   `codenotes.anchorSearchWindow`) for a line with identical trimmed text.
3. If found, the note is silently re-attached and its stored line updated.
4. If not found, the note is marked `orphaned` — it stops showing a gutter
   icon/hover in the editor but remains visible (with a warning icon) in the
   sidebar so you can manually relocate or delete it.

This is **line-content anchoring**, not full AST-based symbol anchoring. It's
resilient to insertions/deletions elsewhere in the file and to line
reordering, but it will not follow a line if its text is edited, and it can't
distinguish two identical lines far apart if both fall within the search
window — it takes the first match found. True symbol-level anchoring (binding
to a function/variable via the language's AST) is a larger, language-specific
effort and is intentionally out of scope for this MVP.

## What's not here (yet)

- **Drawing layer** (arrows, circles, freehand ink over code) — VS Code's
  editor isn't built for arbitrary canvas overlays; this needs a dedicated
  webview-overlay architecture kept in sync with scroll/wrap/zoom, which is
  its own project.
- **AI-assisted note generation** — deliberately deferred; wiring an LLM call
  is easy, but doing it with sane caching, cost control, and trustworthy
  output needs its own design pass.
- **Multi-user / real-time collaboration** and **git-merge-friendly storage**
  for `.codenotes/notes.json` — right now two people annotating the same file
  and both committing the notes file will conflict like any JSON file.
- **Symbol-level (AST) anchoring** — see above.

## Data format

`.codenotes/notes.json` in each workspace folder:

```json
{
  "version": 1,
  "notes": [
    {
      "id": "uuid",
      "filePath": "src/index.ts",
      "line": 41,
      "anchorText": "function loadConfig() {",
      "note": "Reads config from disk, falls back to defaults if missing.",
      "createdAt": "2026-07-11T00:00:00.000Z",
      "updatedAt": "2026-07-11T00:00:00.000Z",
      "orphaned": false
    }
  ]
}
```

Plain JSON, safe to commit to version control if you want notes to be
shared with your team — or add `.codenotes/` to `.gitignore` if you want
them to stay local and personal.
