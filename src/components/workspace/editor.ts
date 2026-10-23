import type { Rect } from "@/lib/notebook/geometry";
import type { EquationObject, TextObject } from "@/lib/notebook/schemas";

export type Tool = "textselect" | "pen" | "pencil" | "highlighter" | "eraser" | "select" | "lasso" | "shape" | "text" | "equation";
export type ShapeKind = "ellipse" | "rect" | "line" | "arrow";

/** A region of the page the student has circled / boxed. Basis for "Ask AI about this". */
export interface SelectionRegion {
  kind: "lasso" | "rect";
  /** Flat page-space polygon. */
  polygon: number[];
  bounds: Rect;
}

export interface EditingDraft {
  isNew: boolean;
  /** Snapshot before editing (null when creating). */
  original: TextObject | EquationObject | null;
  draft: TextObject | EquationObject;
}

export interface EditorState {
  tool: Tool;
  color: string;
  sizes: Record<"pen" | "pencil" | "highlighter" | "shape" | "eraser", number>;
  shapeKind: ShapeKind;
  zoom: number;
  autoFit: boolean;
  selectedIds: string[];
  region: SelectionRegion | null;
  editing: EditingDraft | null;
}

export const COLORS = ["#1c1b1a", "#1d4ed8", "#dc2626", "#15803d", "#ea580c", "#7e22ce"] as const;

export const initialEditor: EditorState = {
  tool: "pen",
  color: COLORS[0],
  sizes: { pen: 3, pencil: 3, highlighter: 6, shape: 3, eraser: 14 },
  shapeKind: "ellipse",
  zoom: 1,
  autoFit: true,
  selectedIds: [],
  region: null,
  editing: null,
};

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.5;

export const DRAWING_TOOLS: Tool[] = ["pen", "pencil", "highlighter"];
