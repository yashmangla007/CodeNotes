// ---------------------------------------------------------------------------
// textTool.ts — Tool for placing, editing, and rendering typed text boxes
//
// Implements Phase 6 typed text boxes.
// Reuses the SelectionManager/ObjectStore/History architecture.
// Spawns a temporary absolutely positioned textarea for inline editing.
// ---------------------------------------------------------------------------

import type { CanvasEngine } from "./canvasEngine";
import type { TextObject, DrawObject } from "../drawTypes";
import { randomUUID } from "./uuid";

export class TextTool {
  // Settings
  public fontSize = 16;
  public bold = false;
  public color = "#e06c75";

  // State
  private activeTextarea: HTMLTextAreaElement | null = null;
  private editingId: string | null = null;
  private spawnX = 0;
  private spawnY = 0;
  private spawnWidth = 0;

  constructor(private readonly engine: CanvasEngine) {}

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", this.onPointerDown);
  }

  detach(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.commitCurrentEdit();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    // Only handle primary click
    if (!e.isPrimary) return;

    // If already editing, commit first
    if (this.activeTextarea) {
      this.commitCurrentEdit();
      e.preventDefault();
      return;
    }

    const pos = this.getPos(e);

    // Check if we clicked on an existing text box
    const hitTextObj = this.findTextObjectAt(pos.x, pos.y);
    if (hitTextObj) {
      this.startEditing(hitTextObj);
    } else {
      // Create a new text box
      this.startEditingNew(pos.x, pos.y);
    }

    e.preventDefault();
  };

  /**
   * Start editing an existing TextObject.
   * Hides the text object from canvas rendering and spawns the input textarea.
   */
  public startEditing(obj: TextObject): void {
    this.commitCurrentEdit();

    this.editingId = obj.id;
    this.engine.editingIds.add(obj.id);
    (this.engine as any).redrawCommitted(); // Redraw to hide it

    this.spawnTextarea(obj.x, obj.y, obj.width, obj.content, obj.fontSize, obj.bold, obj.color);
  }

  /**
   * Start a new TextObject at (x, y).
   */
  private startEditingNew(x: number, y: number): void {
    this.editingId = null;
    const defaultWidth = 250; // Standard wrap width for new text notes
    this.spawnTextarea(x, y - this.fontSize / 2, defaultWidth, "", this.fontSize, this.bold, this.color);
  }

  private spawnTextarea(
    x: number,
    y: number,
    width: number,
    initialText: string,
    fontSize: number,
    bold: boolean,
    color: string
  ): void {
    this.spawnX = x;
    this.spawnY = y;
    this.spawnWidth = width;

    const scrollContainer = this.engine.scrollContainerElement;
    const zoom = this.engine.zoomScale;
    
    const textarea = document.createElement("textarea");
    this.activeTextarea = textarea;

    textarea.style.cssText = `
      position: absolute;
      left: ${x * zoom}px;
      top: ${y * zoom}px;
      width: ${width * zoom}px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: ${fontSize * zoom}px;
      font-weight: ${bold ? "bold" : "normal"};
      color: ${color};
      background: rgba(30, 30, 30, 0.9);
      border: 1px dashed rgba(100, 160, 255, 0.8);
      outline: none;
      resize: none;
      overflow: hidden;
      padding: 4px;
      margin: 0;
      line-height: 1.2;
      z-index: 150;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      border-radius: 4px;
      caret-color: ${color};
    `;

    textarea.value = initialText;
    scrollContainer.appendChild(textarea);

    // Auto-height adjustment helper
    const adjustHeight = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };

    textarea.addEventListener("input", adjustHeight);
    
    // Initial size adjust
    textarea.focus();
    adjustHeight();

    // Prevent keydown propagation (so VS Code shortcuts don't intercept typing)
    textarea.addEventListener("keydown", (e) => {
      e.stopPropagation();

      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        this.commitCurrentEdit();
      } else if (e.key === "Escape") {
        this.cancelCurrentEdit();
      }
    });

    // Commit when clicking away
    textarea.addEventListener("blur", () => {
      // Use setTimeout so if click was on another control that cancels, it executes first
      setTimeout(() => this.commitCurrentEdit(), 150);
    });
  }

  public commitCurrentEdit(): void {
    const textarea = this.activeTextarea;
    const editingId = this.editingId;

    if (!textarea) return;

    this.activeTextarea = null;
    this.editingId = null;

    const textVal = textarea.value.trim();
    textarea.remove();

    if (editingId) {
      this.engine.editingIds.delete(editingId);
    }

    if (textVal === "") {
      // Discard empty text box
      if (editingId) {
        // If editing existing, delete it
        const before = this.engine.getStore().snapshot();
        this.engine.getStore().remove([editingId]);
        this.engine.getHistory().pushAction({
          before,
          after: this.engine.getStore().snapshot(),
        });
        this.engine.onChanged?.();
      }
      (this.engine as any).redrawCommitted();
      return;
    }

    const before = this.engine.getStore().snapshot();

    if (editingId) {
      // Update existing
      const existing = this.engine.getStore().getById(editingId) as TextObject;
      if (existing) {
        const updated: TextObject = {
          ...existing,
          updatedAt: new Date().toISOString(),
          content: textVal,
          // Recalculate height during next render
          height: undefined,
        };
        this.engine.getStore().replace(editingId, updated);
      }
    } else {
      // Create new
      const x = this.spawnX;
      const y = this.spawnY;
      const width = this.spawnWidth;
      const now = new Date().toISOString();

      const newText: TextObject = {
        id: randomUUID(),
        layerId: this.engine.activeLayerId,
        createdAt: now,
        updatedAt: now,
        opacity: 1,
        type: "text",
        x,
        y,
        width,
        content: textVal,
        color: this.color,
        fontSize: this.fontSize,
        bold: this.bold,
      };
      this.engine.getStore().add(newText);
    }

    this.engine.getHistory().pushAction({
      before,
      after: this.engine.getStore().snapshot(),
    });

    this.engine.onChanged?.();
    (this.engine as any).redrawCommitted();
  }

  public cancelCurrentEdit(): void {
    const textarea = this.activeTextarea;
    const editingId = this.editingId;

    if (!textarea) return;

    this.activeTextarea = null;
    this.editingId = null;
    textarea.remove();

    if (editingId) {
      this.engine.editingIds.delete(editingId);
    }

    (this.engine as any).redrawCommitted();
  }

  // ---- Helpers -------------------------------------------------------------

  private getPos(e: PointerEvent): { x: number; y: number } {
    return this.engine.clientToDocument(e.clientX, e.clientY);
  }

  private findTextObjectAt(x: number, y: number): TextObject | null {
    for (const obj of this.engine.getStore().getAll()) {
      if (obj.type === "text") {
        const textObj = obj as TextObject;
        const h = textObj.height ?? 16; // Fallback height if not measured yet
        if (
          x >= textObj.x &&
          x <= textObj.x + textObj.width &&
          y >= textObj.y &&
          y <= textObj.y + h
        ) {
          return textObj;
        }
      }
    }
    return null;
  }
}
