// ---------------------------------------------------------------------------
// main.ts — Webview entry point for Draw Mode
// Phase 6: adds shapes, shift constraint snapping, and typed text boxes.
// ---------------------------------------------------------------------------

import { renderCode, scrollToLine } from "./codeRenderer";
import { CanvasEngine } from "./canvasEngine";
import { PenTool } from "./penTool";
import { EraserTool } from "./eraserTool";
import { SelectionManager } from "./selectionManager";
import { LassoTool } from "./lassoTool";
import { ShapeTool } from "./shapeTool";
import { TextTool } from "./textTool";
import type { TextObject, ImageObject, Layer } from "../drawTypes";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../drawTypes";
import { randomUUID } from "./uuid";

// Acquire the VS Code webview API (available only inside webview iframes).
declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ---- DOM References -------------------------------------------------------

const codeContainer = document.getElementById(
  "code-container"
) as HTMLDivElement;

// ---- State ----------------------------------------------------------------

/** Language ID from the init message, used for re-rendering on sourceChanged. */
let currentLanguageId = "plaintext";

/** Base asset directory URI for resolving relative assetPaths */
let baseAssetUri = "";

/** Tools & Managers */
let engine: CanvasEngine | null = null;
let penTool: PenTool | null = null;
let eraserTool: EraserTool | null = null;
let selectionManager: SelectionManager | null = null;
let lassoTool: LassoTool | null = null;
let shapeTool: ShapeTool | null = null;
let textTool: TextTool | null = null;

type DrawingTool =
  | "pen"
  | "shape-line"
  | "shape-arrow"
  | "shape-rectangle"
  | "shape-ellipse"
  | "text"
  | "eraser-stroke"
  | "eraser-pixel"
  | "select";

/** Current active tool selection */
let activeTool: DrawingTool = "pen";

/** Formatting Presets */
let activeColor = "#e06c75"; // Warm red (default)
let activeStrokeWidth = 4;   // Medium (default)
let activeFontSize = 16;     // Medium (default)
let activeBold = false;

let activeLayers: Layer[] = [
  {
    id: "default",
    name: "Default",
    visible: true,
    order: 0,
  }
];
let activeLayerId = "default";
let isAddingLayer = false;
let activeZoomScale = 1.0;

/** Timer for debouncing save operations to host */
let saveDebounceTimer: any = null;

/** Reference to the currently active toast element (TRD §9 rule 9) */
let activeToastElement: HTMLDivElement | null = null;
/** Timer for auto-dismissing the active toast */
let toastDismissTimer: any = null;

function showToast(message: string): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  // Clear any existing dismiss timer since we are updating/replacing
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }

  if (activeToastElement && activeToastElement.parentNode) {
    // If a toast already exists, update its message and reset its visual state to visible
    activeToastElement.textContent = message;
    activeToastElement.classList.add("visible");
  } else {
    // Create new toast element
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    activeToastElement = toast;

    // Trigger transition
    requestAnimationFrame(() => {
      toast.classList.add("visible");
    });
  }

  // Set timeout to dismiss after 5 seconds
  toastDismissTimer = setTimeout(() => {
    dismissActiveToast();
  }, 5000);
}

function dismissActiveToast(): void {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }

  if (activeToastElement) {
    const el = activeToastElement;
    activeToastElement = null; // Clear reference early to prevent double-disposal
    el.classList.remove("visible");
    // Wait for fadeout animation to complete before removing
    setTimeout(() => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 300); // matches the 0.3s CSS transition
  }
}

// ---- Message Handling -----------------------------------------------------

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as HostToWebviewMessage;

  switch (msg.type) {
    case "init": {
      try {
        currentLanguageId = msg.languageId;
        baseAssetUri = msg.baseAssetUri || "";
        renderCode(codeContainer, msg.sourceCode, msg.languageId);

        // Scroll after layout, then initialise the canvas engine once
        requestAnimationFrame(() => {
          scrollToLine(codeContainer, msg.initialScrollLine, activeZoomScale);
          initCanvas(msg.document);
        });

        logToHost(
          "info",
          `Rendered ${msg.sourceCode.split("\n").length} lines (lang: ${msg.languageId})`
        );
      } catch (err) {
        logToHost("error", `Failed to render code: ${String(err)}`);
      }
      break;
    }

    case "sourceChanged": {
      // Re-render code on external changes, preserving scroll position and
      // the existing canvas drawings.
      try {
        const scrollTop = codeContainer.scrollTop;
        renderCode(codeContainer, msg.sourceCode, currentLanguageId);
        requestAnimationFrame(() => {
          codeContainer.scrollTop = scrollTop;
          // Re-anchor the canvas host inside the refreshed container
          engine?.resize();
        });
      } catch (err) {
        logToHost(
          "error",
          `Failed to re-render on sourceChanged: ${String(err)}`
        );
      }
      break;
    }

    case "imageImported": {
      handleImageImported(msg);
      break;
    }

    case "saveFailed": {
      showToast(`Save failed: ${msg.error}`);
      break;
    }

    case "saveSuccess": {
      dismissActiveToast();
      break;
    }
  }
});

// ---- Canvas initialisation -----------------------------------------------

function initCanvas(document: any): void {
  // Only create once — guard against double init
  if (engine !== null) {
    return;
  }

  try {
    engine = new CanvasEngine(codeContainer);
    engine.loadDocument(document, baseAssetUri);
    
    // Wire change callback to trigger debounced postMessage to host
    engine.onChanged = () => {
      triggerDocumentChanged();
    };

    // Instantiate and connect SelectionManager
    selectionManager = new SelectionManager();
    selectionManager.onClearStrokeCache = (id) => {
      engine?.clearStrokeCache(id);
    };
    selectionManager.onSelectionChange = () => {
      (engine as any).redrawCommitted();
      engine?.renderSelectionOverlay();
    };
    engine.setSelectionManager(selectionManager);

    // Pen Tool
    penTool = new PenTool(engine);
    penTool.color = activeColor;
    penTool.strokeWidth = activeStrokeWidth;
    penTool.attach(engine.activeCanvasElement);

    // Eraser Tool
    eraserTool = new EraserTool(engine);

    // Shape Tool
    shapeTool = new ShapeTool(engine);
    shapeTool.color = activeColor;
    shapeTool.strokeWidth = activeStrokeWidth;

    // Text Tool
    textTool = new TextTool(engine);
    textTool.color = activeColor;
    textTool.fontSize = activeFontSize;
    textTool.bold = activeBold;

    // Lasso / Select Tool
    lassoTool = new LassoTool(
      engine,
      selectionManager,
      engine.getStore(),
      engine.getHistory(),
      () => {
        // Redraw committed and selection layers together during drag actions
        (engine as any).redrawCommitted();
        engine?.renderSelectionOverlay();
      },
      () => {
        // Commits mutating drag actions to disk
        engine?.onChanged?.();
      }
    );

    // Double-click on Select mode edits text boxes
    engine.activeCanvasElement.addEventListener("dblclick", (e) => {
      if (activeTool === "select" && selectionManager && textTool) {
        const pt = engine!.clientToDocument(e.clientX, e.clientY);
        const x = pt.x;
        const y = pt.y;
        
        for (const obj of engine!.getStore().getAll()) {
          if (obj.type === "text") {
            const textObj = obj as TextObject;
            const h = textObj.height ?? 16;
            if (
              x >= textObj.x &&
              x <= textObj.x + textObj.width &&
              y >= textObj.y &&
              y <= textObj.y + h
            ) {
              selectTool("text");
              textTool.startEditing(textObj);
              break;
            }
          }
        }
      }
    });

    // Create the floating toolbar
    createToolbar();

    // Wire up keyboard shortcuts
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      
      // Don't intercept shortcuts when user is typing in the textarea
      if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") {
        return;
      }

      if (isCmdOrCtrl) {
        if (e.key === "z" || e.key === "Z") {
          if (e.shiftKey) {
            engine?.redo();
          } else {
            engine?.undo();
          }
          e.preventDefault();
        } else if (e.key === "y" || e.key === "Y") {
          engine?.redo();
          e.preventDefault();
        } else if (e.key === "d" || e.key === "D") {
          // Duplicate selection shortcut
          if (selectionManager && engine) {
            selectionManager.duplicateSelected(engine.getStore(), engine.getHistory());
            (engine as any).redrawCommitted();
            engine.renderSelectionOverlay();
            engine.onChanged?.();
          }
          e.preventDefault();
        }
      } else {
        if (e.key === "Delete" || e.key === "Backspace") {
          // Delete selection shortcut
          if (selectionManager && engine) {
            selectionManager.deleteSelected(engine.getStore(), engine.getHistory());
            (engine as any).redrawCommitted();
            engine.renderSelectionOverlay();
            engine.onChanged?.();
          }
          e.preventDefault();
        }
      }
    });

    // Initialize layers state
    if (document.layers && document.layers.length > 0) {
      activeLayers = document.layers;
      const hasDefault = activeLayers.some(l => l.id === "default");
      activeLayerId = hasDefault ? "default" : activeLayers[0].id;
    } else {
      activeLayers = [
        {
          id: "default",
          name: "Default",
          visible: true,
          order: 0,
        }
      ];
      activeLayerId = "default";
    }

    engine.activeLayerId = activeLayerId;
    engine.hiddenLayerIds.clear();
    selectionManager.hiddenLayerIds.clear();
    activeLayers.forEach(l => {
      if (!l.visible) {
        engine!.hiddenLayerIds.add(l.id);
        selectionManager!.hiddenLayerIds.add(l.id);
      }
    });

    createLayersPanel();

    logToHost("info", "Canvas engine, tools, shortcuts, and double-click editing initialised");
  } catch (err) {
    logToHost("error", `Failed to initialise canvas: ${String(err)}`);
  }
}

// ---- Document Persistence Trigger ----------------------------------------

function triggerDocumentChanged(): void {
  if (!engine) {
    return;
  }

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    const doc = {
      filePath: "", // Will be filled in posix-style relative path by host
      pageHeightLines: codeContainer.firstElementChild ? codeContainer.firstElementChild.children.length : 0,
      layers: JSON.parse(JSON.stringify(activeLayers)),
      objects: engine!.getAllObjects(),
    };

    vscode.postMessage({
      type: "documentChanged",
      document: doc,
    });
  }, 500); // 500ms debounce per TRD §6.5
}

// ---- Tell the host we're ready -------------------------------------------

vscode.postMessage({ type: "ready" });

// ---- SVG icon library (inline, zero external deps) ----------------------
const ICONS: Record<string, string> = {
  select:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4l7.5 18 3.5-7.5L22 11z"/></svg>`,
  pen:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`,
  line:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="5" y1="19" x2="19" y2="5"/></svg>`,
  arrow:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="10,5 19,5 19,14"/></svg>`,
  rect:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  ellipse:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>`,
  text:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="4" y1="7" x2="20" y2="7"/><line x1="12" y1="7" x2="12" y2="21"/></svg>`,
  image:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>`,
  eraseStroke:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 20H7L3 16l13-13 7 7z"/><line x1="6" y1="14" x2="18" y2="14"/></svg>`,
  erasePixel:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 20H7L3 16l13-13 7 7z"/><line x1="2" y1="22" x2="22" y2="22"/></svg>`,
  undo:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="9,14 4,9 9,4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`,
  redo:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="15,14 20,9 15,4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>`,
  zoomIn:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  zoomOut:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  eye:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
};

function svgIcon(name: string): string {
  return ICONS[name] ?? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8"/></svg>`;
}

// ---- Floating Toolbar UI ----------------------------------------------
function createToolbar(): void {
  const toolbar = document.createElement("div");
  toolbar.id = "toolbar";

  // Row 1: Tools Group & History
  const rowTools = document.createElement("div");
  rowTools.className = "toolbar-row";

  const btnSelect       = createToolButton("btn-select",           svgIcon("select"),      "Select",        false);
  const btnPen          = createToolButton("btn-pen",              svgIcon("pen"),         "Pen",           true);
  const btnLine         = createToolButton("btn-shape-line",       svgIcon("line"),        "Line",          false);
  const btnArrow        = createToolButton("btn-shape-arrow",      svgIcon("arrow"),       "Arrow",         false);
  const btnRect         = createToolButton("btn-shape-rectangle",  svgIcon("rect"),        "Rectangle",     false);
  const btnEllipse      = createToolButton("btn-shape-ellipse",    svgIcon("ellipse"),     "Ellipse",       false);
  const btnText         = createToolButton("btn-text",             svgIcon("text"),        "Text",          false);
  const btnStrokeEraser = createToolButton("btn-eraser-stroke",    svgIcon("eraseStroke"), "Stroke Eraser", false);
  const btnPixelEraser  = createToolButton("btn-eraser-pixel",     svgIcon("erasePixel"),  "Pixel Eraser",  false);
  const btnImage        = createToolButton("btn-image",            svgIcon("image"),       "Insert Image",  false);

  btnSelect.addEventListener("click",       () => selectTool("select"));
  btnPen.addEventListener("click",          () => selectTool("pen"));
  btnLine.addEventListener("click",         () => selectTool("shape-line"));
  btnArrow.addEventListener("click",        () => selectTool("shape-arrow"));
  btnRect.addEventListener("click",         () => selectTool("shape-rectangle"));
  btnEllipse.addEventListener("click",      () => selectTool("shape-ellipse"));
  btnText.addEventListener("click",         () => selectTool("text"));
  btnStrokeEraser.addEventListener("click", () => selectTool("eraser-stroke"));
  btnPixelEraser.addEventListener("click",  () => selectTool("eraser-pixel"));
  btnImage.addEventListener("click", () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) { handleImageFile(file); }
    };
    fileInput.click();
  });

  rowTools.appendChild(btnSelect);
  rowTools.appendChild(btnPen);
  rowTools.appendChild(btnLine);
  rowTools.appendChild(btnArrow);
  rowTools.appendChild(btnRect);
  rowTools.appendChild(btnEllipse);
  rowTools.appendChild(btnText);
  rowTools.appendChild(btnStrokeEraser);
  rowTools.appendChild(btnPixelEraser);
  rowTools.appendChild(btnImage);

  const sep1 = document.createElement("div");
  sep1.className = "toolbar-separator";
  rowTools.appendChild(sep1);

  const btnUndo = createActionButton(svgIcon("undo"), "Undo", () => engine?.undo());
  const btnRedo = createActionButton(svgIcon("redo"), "Redo", () => engine?.redo());
  btnUndo.disabled = true;
  btnRedo.disabled = true;

  rowTools.appendChild(btnUndo);
  rowTools.appendChild(btnRedo);

  toolbar.appendChild(rowTools);

  // Row 2: Styling Presets Group & Zoom
  const rowStyle = document.createElement("div");
  rowStyle.className = "toolbar-row";

  // Colors Group
  const colorGroup = document.createElement("div");
  colorGroup.className = "color-palette";
  const colors = [
    { value: "#e06c75", label: "Red" },
    { value: "#98c379", label: "Green" },
    { value: "#61afef", label: "Blue" },
    { value: "#d19a66", label: "Orange" },
    { value: "#ffffff", label: "White" }
  ];
  const colorCircles: HTMLDivElement[] = [];
  colors.forEach(col => {
    const circle = document.createElement("div");
    circle.className = "color-swatch";
    circle.style.backgroundColor = col.value;
    circle.title = col.label;
    if (activeColor === col.value) { circle.classList.add("active"); }
    circle.addEventListener("click", () => {
      activeColor = col.value;
      if (penTool)  penTool.color  = activeColor;
      if (shapeTool) shapeTool.color = activeColor;
      if (textTool)  textTool.color  = activeColor;
      if (selectionManager && engine) {
        selectionManager.changeSelectedColor(activeColor, engine.getStore(), engine.getHistory());
        (engine as any).redrawCommitted();
        engine.renderSelectionOverlay();
        engine.onChanged?.();
      }
      colorCircles.forEach((c, idx) => {
        c.classList.toggle("active", colors[idx].value === activeColor);
      });
    });
    colorCircles.push(circle);
    colorGroup.appendChild(circle);
  });
  rowStyle.appendChild(colorGroup);

  const sep2 = document.createElement("div");
  sep2.className = "toolbar-separator";
  rowStyle.appendChild(sep2);

  // Width Group — dot visual
  const widthGroup = document.createElement("div");
  widthGroup.className = "toolbar-group";
  const widths = [2, 4, 8];
  const widthLabels = ["Thin", "Medium", "Thick"];
  const widthDots   = [4, 6, 8];
  const widthButtons: HTMLButtonElement[] = [];
  widths.forEach((w, i) => {
    const btn = document.createElement("button");
    btn.className = activeStrokeWidth === w ? "action-btn active" : "action-btn";
    btn.setAttribute("data-tip", widthLabels[i]);
    const dot = document.createElement("span");
    dot.className = "width-dot";
    dot.style.width  = `${widthDots[i]}px`;
    dot.style.height = `${widthDots[i]}px`;
    btn.appendChild(dot);
    btn.addEventListener("click", () => {
      activeStrokeWidth = w;
      if (shapeTool) shapeTool.strokeWidth = activeStrokeWidth;
      if (penTool)   penTool.strokeWidth   = activeStrokeWidth;
      if (selectionManager && engine) {
        selectionManager.changeSelectedStrokeWidth(activeStrokeWidth, engine.getStore(), engine.getHistory());
        (engine as any).redrawCommitted();
        engine.renderSelectionOverlay();
        engine.onChanged?.();
      }
      widthButtons.forEach((b, idx) => {
        b.classList.toggle("active", widths[idx] === activeStrokeWidth);
      });
    });
    widthButtons.push(btn);
    widthGroup.appendChild(btn);
  });
  rowStyle.appendChild(widthGroup);

  const sep3 = document.createElement("div");
  sep3.className = "toolbar-separator";
  rowStyle.appendChild(sep3);

  // Text Formats Group
  const textGroup = document.createElement("div");
  textGroup.className = "toolbar-group";

  const btnBold = document.createElement("button");
  btnBold.className = activeBold ? "action-btn active" : "action-btn";
  btnBold.setAttribute("data-tip", "Bold");
  const boldSpan = document.createElement("span");
  boldSpan.className = "btn-bold-text";
  boldSpan.textContent = "B";
  btnBold.appendChild(boldSpan);
  btnBold.addEventListener("click", () => {
    activeBold = !activeBold;
    if (textTool) textTool.bold = activeBold;
    if (selectionManager && engine) {
      const store = engine.getStore();
      const before = store.snapshot();
      let changed = false;
      for (const id of selectionManager.getSelectedIds()) {
        const obj = store.getById(id);
        if (obj && obj.type === "text") {
          store.replace(id, { ...obj, updatedAt: new Date().toISOString(), bold: activeBold, height: undefined });
          changed = true;
        }
      }
      if (changed) {
        engine.getHistory().pushAction({ before, after: store.snapshot() });
        (engine as any).redrawCommitted();
        engine.renderSelectionOverlay();
        engine.onChanged?.();
      }
    }
    btnBold.classList.toggle("active", activeBold);
  });
  textGroup.appendChild(btnBold);

  const fontSizes = [12, 16, 20, 24];
  const fontSizeLabels = ["S – 12px", "M – 16px", "L – 20px", "XL – 24px"];
  const fontSizeShort  = ["S", "M", "L", "XL"];
  const fontSizeButtons: HTMLButtonElement[] = [];
  fontSizes.forEach((fs, i) => {
    const btn = document.createElement("button");
    btn.className = activeFontSize === fs ? "action-btn active" : "action-btn";
    btn.setAttribute("data-tip", fontSizeLabels[i]);
    const lbl = document.createElement("span");
    lbl.className = "font-size-label";
    lbl.textContent = fontSizeShort[i];
    btn.appendChild(lbl);
    btn.addEventListener("click", () => {
      activeFontSize = fs;
      if (textTool) textTool.fontSize = activeFontSize;
      if (selectionManager && engine) {
        const store = engine.getStore();
        const before = store.snapshot();
        let changed = false;
        for (const id of selectionManager.getSelectedIds()) {
          const obj = store.getById(id);
          if (obj && obj.type === "text") {
            store.replace(id, { ...obj, updatedAt: new Date().toISOString(), fontSize: activeFontSize, height: undefined });
            changed = true;
          }
        }
        if (changed) {
          engine.getHistory().pushAction({ before, after: store.snapshot() });
          (engine as any).redrawCommitted();
          engine.renderSelectionOverlay();
          engine.onChanged?.();
        }
      }
      fontSizeButtons.forEach((b, idx) => {
        b.classList.toggle("active", fontSizes[idx] === activeFontSize);
      });
    });
    fontSizeButtons.push(btn);
    textGroup.appendChild(btn);
  });
  rowStyle.appendChild(textGroup);

  const sep4 = document.createElement("div");
  sep4.className = "toolbar-separator";
  rowStyle.appendChild(sep4);

  // Zoom Group
  const zoomGroup = document.createElement("div");
  zoomGroup.className = "toolbar-group";

  const btnZoomOut = createActionButton(svgIcon("zoomOut"), "Zoom Out", () => changeZoom(-0.1));
  const zoomLabel = document.createElement("span");
  zoomLabel.id = "zoom-label";
  zoomLabel.textContent = `${Math.round(activeZoomScale * 100)}%`;
  zoomLabel.title = "Double-click to reset";
  zoomLabel.addEventListener("dblclick", () => { changeZoom(1.0 - activeZoomScale); });
  const btnZoomIn = createActionButton(svgIcon("zoomIn"), "Zoom In", () => changeZoom(0.1));

  zoomGroup.appendChild(btnZoomOut);
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(btnZoomIn);
  rowStyle.appendChild(zoomGroup);

  toolbar.appendChild(rowStyle);

  let uiContainer = document.getElementById("draw-ui-container");
  if (!uiContainer) {
    uiContainer = document.createElement("div");
    uiContainer.id = "draw-ui-container";
    document.body.appendChild(uiContainer);
  }
  uiContainer.appendChild(toolbar);

  // Dynamic Padding Observation: ResizeObserver sets the top padding of code container dynamically
  const toolbarResizeObserver = new ResizeObserver(() => {
    const rect = toolbar.getBoundingClientRect();
    codeContainer.style.paddingTop = `${rect.height + 16}px`;
  });
  toolbarResizeObserver.observe(toolbar);

  if (engine) {
    engine.onHistoryStateChange = () => {
      btnUndo.disabled = !engine?.canUndo();
      btnRedo.disabled = !engine?.canRedo();
    };
  }
}

function createToolButton(id: string, iconHtml: string, tooltip: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = id;
  btn.innerHTML = iconHtml;
  btn.className = active ? "tool-btn active" : "tool-btn";
  btn.setAttribute("data-tip", tooltip);
  return btn;
}

function createActionButton(iconHtml: string, tooltip: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.innerHTML = iconHtml;
  btn.className = "action-btn";
  btn.setAttribute("data-tip", tooltip);
  btn.addEventListener("click", onClick);
  return btn;
}

function selectTool(tool: DrawingTool): void {
  activeTool = tool;

  // Reset active classes
  document.querySelectorAll(".tool-btn").forEach((b: any) => {
    b.classList.remove("active");
  });

  // Highlight active tool button
  const btnId = `btn-${tool}`;
  const activeBtn = document.getElementById(btnId) as HTMLButtonElement;
  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  if (!engine) return;

  // Detach all tools
  penTool?.detach(engine.activeCanvasElement);
  eraserTool?.detach(engine.activeCanvasElement);
  lassoTool?.detach(engine.activeCanvasElement);
  shapeTool?.detach(engine.activeCanvasElement);
  textTool?.detach(engine.activeCanvasElement);

  // Attach active tool and update active layer settings
  if (tool === "pen") {
    penTool?.attach(engine.activeCanvasElement);
    engine.activeCanvasElement.style.cursor = "crosshair";
  } else if (tool.startsWith("shape-")) {
    if (shapeTool) {
      shapeTool.shapeType = tool.substring(6) as any;
      shapeTool.attach(engine.activeCanvasElement);
    }
    engine.activeCanvasElement.style.cursor = "crosshair";
  } else if (tool === "text") {
    textTool?.attach(engine.activeCanvasElement);
    engine.activeCanvasElement.style.cursor = "text";
  } else if (tool === "select") {
    lassoTool?.attach(engine.activeCanvasElement);
    engine.activeCanvasElement.style.cursor = "default";
  } else {
    if (eraserTool) {
      eraserTool.mode = tool === "eraser-stroke" ? "stroke" : "pixel";
      eraserTool.attach(engine.activeCanvasElement);
    }
    engine.activeCanvasElement.style.cursor = "default";
  }

  // De-select anything on tool switch (except when switching to text to edit, handled by startEditing)
  if (tool !== "select" && tool !== "text") {
    selectionManager?.clearSelection();
  }
}

// ---- Helpers -------------------------------------------------------------

function logToHost(level: "info" | "warn" | "error", message: string): void {
  vscode.postMessage({ type: "log", level, message });
}

// ---- Image Import Helpers --------------------------------------------------

function handleImageFile(file: File, dropX?: number, dropY?: number): void {
  logToHost("info", `Starting image import for file: ${file.name} (${file.type}, size: ${file.size} bytes)`);

  const reader = new FileReader();
  reader.onload = (readerEvent: ProgressEvent<FileReader>) => {
    const dataUrl = readerEvent.target?.result as string;
    if (!dataUrl) {
      logToHost("error", "FileReader result was empty");
      return;
    }

    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      const maxDim = 2000;

      logToHost("info", `Loaded image dimensions: ${width}x${height}`);

      // Downscale if exceeds 2000px on any side
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        logToHost("info", `Downscaled image dimensions: ${width}x${height}`);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        logToHost("error", "Failed to get 2d context for image downscaling");
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const mimeType = file.type || "image/png";
      const finalDataUrl = canvas.toDataURL(mimeType);

      // Determine suggested file extension
      let ext = "png";
      if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
        ext = "jpg";
      } else if (mimeType === "image/gif") {
        ext = "gif";
      } else if (mimeType === "image/webp") {
        ext = "webp";
      }

      // Default sizing on canvas
      const defaultWidth = Math.min(350, width);
      const defaultHeight = Math.round((height * defaultWidth) / width);

      // Default coordinates (placed centered in viewport or at drop position)
      let targetX = 100;
      let targetY = 100;

      if (dropX !== undefined && dropY !== undefined) {
        targetX = dropX - defaultWidth / 2;
        targetY = dropY - defaultHeight / 2;
        logToHost("info", `Target coordinates set from drop position: (${targetX}, ${targetY})`);
      } else {
        const container = document.getElementById("code-container");
        if (container) {
          const scrollLeft = container.scrollLeft;
          const scrollTop = container.scrollTop;
          const viewportWidth = container.clientWidth;
          const viewportHeight = container.clientHeight;

          targetX = scrollLeft + viewportWidth / 2 - defaultWidth / 2;
          targetY = scrollTop + viewportHeight / 2 - defaultHeight / 2;
          logToHost("info", `Target coordinates set centered in viewport: (${targetX}, ${targetY})`);
        }
      }

      logToHost("info", "Sending requestImageImport message to host...");
      // Send import request to host
      vscode.postMessage({
        type: "requestImageImport",
        dataUrl: finalDataUrl,
        suggestedExt: ext,
        width: defaultWidth,
        height: defaultHeight,
        x: targetX,
        y: targetY,
      });
    };

    img.onerror = (e) => {
      logToHost("error", `Failed to parse image from file data: ${String(e)}`);
    };

    img.src = dataUrl;
  };

  reader.onerror = (e) => {
    logToHost("error", `FileReader failed to read file: ${String(e)}`);
  };

  reader.readAsDataURL(file);
}

function handleImageImported(msg: any): void {
  logToHost("info", `Received imageImported message. assetPath: ${msg.assetPath}, size: ${msg.width}x${msg.height}`);
  if (!engine || !selectionManager) {
    logToHost("error", "Engine or SelectionManager not initialized inside handleImageImported");
    return;
  }

  const store = engine.getStore();
  const beforeSnapshot = store.snapshot();

  const now = new Date().toISOString();
  const newImage: ImageObject = {
    id: randomUUID(),
    layerId: activeLayerId,
    createdAt: now,
    updatedAt: now,
    opacity: 1,
    type: "image",
    x: msg.x ?? 100,
    y: msg.y ?? 100,
    width: msg.width,
    height: msg.height,
    assetPath: msg.assetPath,
  };

  // Add the newly imported image to the store
  store.add(newImage);

  // Record action in history
  engine.getHistory().pushAction({
    before: beforeSnapshot,
    after: store.snapshot(),
  });

  // Switch tool to select
  selectTool("select");

  // Select the newly created image object
  selectionManager.selectObject(newImage.id);

  logToHost("info", `Inserted ImageObject ${newImage.id} into store, rendering & saving...`);

  // Redraw canvases and trigger persistence save
  (engine as any).redrawCommitted();
  engine.renderSelectionOverlay();
  engine.onChanged?.();
}

// ---- Paste Event Listener -------------------------------------------------
document.addEventListener("paste", (e: ClipboardEvent) => {
  if (!engine) return;

  // Don't hijack paste if user is typing in a textarea/input
  if (
    document.activeElement?.tagName === "TEXTAREA" ||
    document.activeElement?.tagName === "INPUT"
  ) {
    return;
  }

  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.indexOf("image") !== -1) {
      const file = item.getAsFile();
      if (file) {
        logToHost("info", "Interceted paste event with image data");
        handleImageFile(file);
        e.preventDefault();
        e.stopPropagation();
        break;
      }
    }
  }
});

// ---- Drag and Drop Event Listeners ---------------------------------------
document.addEventListener("dragenter", (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener("dragover", (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "copy";
  }
});

document.addEventListener("drop", (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (!engine) return;

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.type.startsWith("image/")) {
      logToHost("info", "Intercepted drop event with image data");
      const pt = engine.clientToDocument(e.clientX, e.clientY);
      handleImageFile(file, pt.x, pt.y);
    }
  }
});

// ---- Layers UI & Helpers ---------------------------------------------------

function createLayersPanel(): void {
  let panel = document.getElementById("layers-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "layers-panel";

    let uiContainer = document.getElementById("draw-ui-container");
    if (!uiContainer) {
      uiContainer = document.createElement("div");
      uiContainer.id = "draw-ui-container";
      document.body.appendChild(uiContainer);
    }
    uiContainer.appendChild(panel);
  }

  // Clear existing content
  panel.innerHTML = "";

  // Title Row
  const header = document.createElement("div");
  header.className = "layers-header";

  const title = document.createElement("span");
  title.textContent = "Layers";
  title.className = "layers-title";
  header.appendChild(title);

  // Add Layer controls (inline text field vs button)
  if (isAddingLayer) {
    const inputContainer = document.createElement("div");
    inputContainer.style.cssText = "display: flex; gap: 4px; align-items: center;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Name...";
    input.className = "layer-input";
    inputContainer.appendChild(input);

    const btnOk = document.createElement("button");
    btnOk.textContent = "✔";
    btnOk.style.cssText = "background: transparent; border: none; color: #a6e22e; cursor: pointer; font-size: 10px; padding: 2px; font-weight: bold;";
    btnOk.addEventListener("click", () => {
      const name = input.value.trim();
      if (name !== "") {
        createNewLayer(name);
      }
      isAddingLayer = false;
      createLayersPanel();
    });
    inputContainer.appendChild(btnOk);

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "✖";
    btnCancel.style.cssText = "background: transparent; border: none; color: #f92672; cursor: pointer; font-size: 10px; padding: 2px; font-weight: bold;";
    btnCancel.addEventListener("click", () => {
      isAddingLayer = false;
      createLayersPanel();
    });
    inputContainer.appendChild(btnCancel);

    header.appendChild(inputContainer);

    // Auto-focus input
    setTimeout(() => input.focus(), 50);

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const name = input.value.trim();
        if (name !== "") {
          createNewLayer(name);
        }
        isAddingLayer = false;
        createLayersPanel();
      } else if (e.key === "Escape") {
        isAddingLayer = false;
        createLayersPanel();
      }
    });
  } else {
    const btnAdd = document.createElement("button");
    btnAdd.textContent = "＋ New";
    btnAdd.style.cssText = `
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #e5e5e5;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      outline: none;
      transition: background 0.1s;
    `;
    btnAdd.addEventListener("mouseover", () => btnAdd.style.background = "rgba(255,255,255,0.05)");
    btnAdd.addEventListener("mouseout", () => btnAdd.style.background = "transparent");
    btnAdd.addEventListener("click", () => {
      isAddingLayer = true;
      createLayersPanel();
    });
    header.appendChild(btnAdd);
  }
  panel.appendChild(header);

  // Layer List Container
  const listContainer = document.createElement("div");
  listContainer.className = "layers-list";

  activeLayers.forEach(layer => {
    const item = document.createElement("div");
    const isActive = layer.id === activeLayerId;
    item.className = isActive ? "layer-item active" : "layer-item";

    // Left controls: Eye + Name
    const leftContainer = document.createElement("div");
    leftContainer.className = "layer-left";

    const btnVis = document.createElement("span");
    btnVis.innerHTML = layer.visible ? svgIcon("eye") : svgIcon("eyeOff");
    btnVis.className = "layer-vis-btn";
    btnVis.addEventListener("click", (e) => {
      e.stopPropagation(); // prevent setting active layer when toggling visibility
      toggleLayerVisibility(layer.id);
    });
    leftContainer.appendChild(btnVis);

    const nameSpan = document.createElement("span");
    nameSpan.textContent = layer.name;
    nameSpan.className = "layer-name";
    leftContainer.appendChild(nameSpan);
    item.appendChild(leftContainer);

    // Clicking item sets it as active layer
    item.addEventListener("click", () => {
      setActiveLayer(layer.id);
    });

    listContainer.appendChild(item);
  });

  panel.appendChild(listContainer);
}

function createNewLayer(name: string): void {
  const newLayer: Layer = {
    id: randomUUID(),
    name,
    visible: true,
    order: activeLayers.length,
  };

  activeLayers.push(newLayer);
  activeLayerId = newLayer.id;
  if (engine) {
    engine.activeLayerId = activeLayerId;
  }

  createLayersPanel();
  triggerDocumentChanged();
}

function toggleLayerVisibility(id: string): void {
  const layer = activeLayers.find(l => l.id === id);
  if (layer) {
    layer.visible = !layer.visible;

    if (layer.visible) {
      engine?.hiddenLayerIds.delete(id);
      selectionManager?.hiddenLayerIds.delete(id);
    } else {
      engine?.hiddenLayerIds.add(id);
      selectionManager?.hiddenLayerIds.add(id);

      // Immediately remove any objects on this hidden layer from selection
      if (selectionManager && engine) {
        selectionManager.deselectObjectsOnLayer(id, engine.getStore());
      }
    }

    // Repaint committed canvas and selection overlay immediately
    if (engine) {
      (engine as any).redrawCommitted();
      engine.renderSelectionOverlay();
    }

    createLayersPanel();
    triggerDocumentChanged();
  }
}

function setActiveLayer(id: string): void {
  activeLayerId = id;
  if (engine) {
    engine.activeLayerId = id;
    // Repaint committed canvas and selection overlay immediately
    (engine as any).redrawCommitted();
    engine.renderSelectionOverlay();
  }
  createLayersPanel();
}

// ---- Zoom Helpers & Listeners ----------------------------------------------

function changeZoom(delta: number): void {
  const newScale = Math.max(0.5, Math.min(2.0, activeZoomScale + delta));
  if (newScale === activeZoomScale) return;

  const oldScale = activeZoomScale;
  activeZoomScale = parseFloat(newScale.toFixed(1));

  // Viewport center preservation
  const container = codeContainer;
  const centerX = container.scrollLeft + container.clientWidth / 2;
  const centerY = container.scrollTop + container.clientHeight / 2;

  const docCenterX = centerX / oldScale;
  const docCenterY = centerY / oldScale;

  // Update CSS zoom property
  document.body.style.setProperty("--zoom-scale", activeZoomScale.toString());

  // Sync zoomScale to the engine
  if (engine) {
    engine.zoomScale = activeZoomScale;
    engine.resize();
    (engine as any).redrawCommitted();
    engine.renderSelectionOverlay();
  }

  // Restore center scroll position
  container.scrollLeft = docCenterX * activeZoomScale - container.clientWidth / 2;
  container.scrollTop = docCenterY * activeZoomScale - container.clientHeight / 2;

  // Update toolbar label
  const label = document.getElementById("zoom-label");
  if (label) {
    label.textContent = `${Math.round(activeZoomScale * 100)}%`;
  }
}

// Hold Ctrl/Cmd and scroll wheel to zoom
document.addEventListener("wheel", (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    changeZoom(delta);
  }
}, { passive: false });

