// ---------------------------------------------------------------------------
// codeRenderer.ts — Renders source code as syntax-highlighted HTML
// Uses highlight.js (TRD §3 lighter fallback option).
// ---------------------------------------------------------------------------

import hljs from "highlight.js";

/** Fixed line height in pixels — used for scroll calculations. */
export const LINE_HEIGHT_PX = 20;

/** Padding (in px) around the code block. */
export const CODE_PADDING_TOP = 8;

/**
 * Map from VS Code languageId to highlight.js language name.
 * highlight.js auto-detects when we return undefined, but explicit
 * mapping gives much better results for common languages.
 */
const LANG_MAP: Record<string, string> = {
  typescript: "typescript",
  typescriptreact: "typescript",
  javascript: "javascript",
  javascriptreact: "javascript",
  python: "python",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  go: "go",
  rust: "rust",
  ruby: "ruby",
  php: "php",
  swift: "swift",
  kotlin: "kotlin",
  html: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  markdown: "markdown",
  shellscript: "bash",
  bash: "bash",
  powershell: "powershell",
  sql: "sql",
  xml: "xml",
  lua: "lua",
  r: "r",
  perl: "perl",
  dart: "dart",
  dockerfile: "dockerfile",
  makefile: "makefile",
  plaintext: "plaintext",
};

/**
 * Renders syntax-highlighted code into the given container element.
 * Each line becomes a separate `<div class="code-line">` with a line-number
 * gutter and the highlighted source.
 *
 * @returns The total number of lines rendered.
 */
export function renderCode(
  container: HTMLElement,
  sourceCode: string,
  languageId: string
): number {
  const hljsLang = LANG_MAP[languageId];
  let highlighted: string;

  try {
    if (hljsLang && hljs.getLanguage(hljsLang)) {
      highlighted = hljs.highlight(sourceCode, { language: hljsLang }).value;
    } else {
      // Fall back to auto-detection
      highlighted = hljs.highlightAuto(sourceCode).value;
    }
  } catch {
    // If highlighting fails entirely, render as plain escaped text
    highlighted = escapeHtml(sourceCode);
  }

  // Split highlighted HTML by newlines. highlight.js preserves newlines
  // in its output, so splitting on \n gives us per-line HTML fragments.
  const lines = highlighted.split("\n");

  // Build the HTML. We use a document fragment for performance.
  const gutterWidth = String(lines.length).length;
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < lines.length; i++) {
    const lineDiv = document.createElement("div");
    lineDiv.className = "code-line";
    lineDiv.dataset.line = String(i);
    lineDiv.style.height = `calc(${LINE_HEIGHT_PX}px * var(--zoom-scale, 1.0))`;
    lineDiv.style.lineHeight = `calc(${LINE_HEIGHT_PX}px * var(--zoom-scale, 1.0))`;

    const gutterSpan = document.createElement("span");
    gutterSpan.className = "line-gutter";
    gutterSpan.textContent = String(i + 1).padStart(gutterWidth, " ");

    const codeSpan = document.createElement("span");
    codeSpan.className = "line-content";
    codeSpan.innerHTML = lines[i] || " "; // empty lines get a space to preserve height

    lineDiv.appendChild(gutterSpan);
    lineDiv.appendChild(codeSpan);
    fragment.appendChild(lineDiv);
  }

  container.innerHTML = "";
  container.appendChild(fragment);

  return lines.length;
}

/**
 * Scrolls the container so that the given line number is at the top.
 */
export function scrollToLine(container: HTMLElement, line: number, zoomScale: number = 1.0): void {
  const targetY = (CODE_PADDING_TOP + line * LINE_HEIGHT_PX) * zoomScale;
  container.scrollTop = targetY;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
