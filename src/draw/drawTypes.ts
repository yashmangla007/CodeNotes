// ---------------------------------------------------------------------------
// Draw Mode — Shared Types
// Matches TRD Section 4.2 (data model) and Section 5 (messages).
// Phase 1 only uses the message types; the object/layer types are defined
// here for forward compatibility so the init message signature is correct.
// ---------------------------------------------------------------------------

// ---- Object ID -----------------------------------------------------------

export type ObjectId = string; // uuid

// ---- Object Schema (TRD §4.2) --------------------------------------------

export interface BaseObject {
  id: ObjectId;
  layerId: string;
  createdAt: string;
  updatedAt: string;
  opacity: number; // 0–1
}

export interface StrokeObject extends BaseObject {
  type: "stroke";
  tool: "pen" | "highlighter";
  color: string; // hex
  baseWidth: number; // in reference px
  points: { x: number; y: number; pressure: number }[];
}

export interface ShapeObject extends BaseObject {
  type: "shape";
  shape: "line" | "arrow" | "rectangle" | "ellipse";
  color: string;
  strokeWidth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextObject extends BaseObject {
  type: "text";
  x: number;
  y: number;
  width: number;
  height?: number; // dynamic or cached height for bounding box & hit testing
  content: string;
  color: string;
  fontSize: number;
  bold: boolean;
}

export interface ImageObject extends BaseObject {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  assetPath: string; // relative path under .codenotes/drawings/assets/
}

export type DrawObject = StrokeObject | ShapeObject | TextObject | ImageObject;

// ---- Layers & Document ---------------------------------------------------

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

export interface FileDrawingDocument {
  filePath: string; // workspace-relative, posix separators
  pageHeightLines: number; // rendered code length in lines at save-time
  layers: Layer[];
  objects: DrawObject[];
}

// ---- Extension ↔ Webview Messages (TRD §5) --------------------------------

export type HostToWebviewMessage =
  | {
      type: "init";
      document: FileDrawingDocument;
      sourceCode: string;
      languageId: string;
      initialScrollLine: number;
      baseAssetUri?: string;
    }
  | { type: "sourceChanged"; sourceCode: string }
  | { type: "requestSave" }
  | { type: "saveFailed"; error: string }
  | { type: "saveSuccess" }
  | {
      type: "imageImported";
      assetPath: string;
      webviewUri: string;
      width: number;
      height: number;
      x?: number;
      y?: number;
    };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "documentChanged"; document: FileDrawingDocument }
  | {
      type: "requestImageImport";
      dataUrl: string;
      suggestedExt: string;
      width: number;
      height: number;
      x?: number;
      y?: number;
    }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };
