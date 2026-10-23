import { z } from "zod";

/**
 * Persisted notebook object format. Intentionally independent of Konva / DOM:
 * geometry is in page units, ink points are relative to the object's (x, y) origin.
 */

export const PAGE_TYPES = ["BLANK", "RULED", "GRID", "PDF"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const OBJECT_TYPES = ["INK", "TEXT", "EQUATION", "SHAPE", "IMAGE", "GRAPH", "AI_SOLUTION", "SELECTION"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

const color = z.string().regex(/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/, "Expected a hex colour");
const finite = z.number().finite();

export const inkDataSchema = z.object({
  tool: z.enum(["pen", "pencil", "highlighter"]),
  color,
  size: z.number().min(0.5).max(80),
  opacity: z.number().min(0.05).max(1).default(1),
  /** Flat [x0, y0, x1, y1, ...] relative to the object origin. */
  points: z.array(finite).min(2).max(40_000),
  /** One pressure value (0..1) per point, when the device reports it. */
  pressures: z.array(z.number().min(0).max(1)).max(20_000).optional(),
  /** Milliseconds since stroke start, per point, when available. */
  times: z.array(z.number().min(0)).max(20_000).optional(),
});

export const textDataSchema = z.object({
  text: z.string().max(20_000),
  fontSize: z.number().min(8).max(200),
  color,
  fontFamily: z.enum(["sans", "serif", "hand", "mono"]).default("sans"),
});

export const equationDataSchema = z.object({
  latex: z.string().max(5_000),
  fontSize: z.number().min(8).max(200),
  color,
});

export const shapeDataSchema = z.object({
  shape: z.enum(["ellipse", "rect", "line", "arrow"]),
  stroke: color,
  strokeWidth: z.number().min(0.5).max(40),
  fill: color.nullable().default(null),
  /** For line/arrow: end point relative to the object origin (start is 0,0 when flipped is false). */
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});

export const graphDataSchema = z.object({
  expressions: z
    .array(
      z.object({
        id: z.string().max(64),
        latex: z.string().max(1_000),
        color,
        /** Set when the expression is driven by a linked equation object. */
        sourceObjectId: z.string().max(64).optional(),
      }),
    )
    .max(20),
  viewport: z.object({ xmin: finite, xmax: finite, ymin: finite, ymax: finite }),
});

export const imageDataSchema = z.object({
  storageKey: z.string().max(512),
  alt: z.string().max(500).default(""),
});

export const aiSolutionDataSchema = z.object({
  title: z.string().max(300).default("Solution"),
  steps: z
    .array(z.object({ latex: z.string().max(2_000), explanation: z.string().max(2_000) }))
    .max(40),
  finalAnswer: z.string().max(1_000).optional(),
  verificationStatus: z.enum(["PENDING", "VERIFIED", "INCORRECT", "UNCERTAIN", "UNSUPPORTED"]).default("PENDING"),
  sourceQuestion: z.string().max(4_000).optional(),
  messageId: z.string().max(64).optional(),
});

export const selectionDataSchema = z.object({
  kind: z.enum(["rect", "lasso"]),
  /** Lasso polygon in page units (flat x,y), when kind = "lasso". */
  polygon: z.array(finite).max(4_000).optional(),
});

const base = {
  id: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  x: finite,
  y: finite,
  width: finite.min(0),
  height: finite.min(0),
  rotation: finite.default(0),
  zIndex: z.number().int().default(0),
  source: z.enum(["USER", "AI"]).default("USER"),
  linkedToId: z.string().max(64).nullable().default(null),
  metadata: z.record(z.string(), z.json()).nullable().default(null),
};

export const notebookObjectSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("INK"), data: inkDataSchema }),
  z.object({ ...base, type: z.literal("TEXT"), data: textDataSchema }),
  z.object({ ...base, type: z.literal("EQUATION"), data: equationDataSchema }),
  z.object({ ...base, type: z.literal("SHAPE"), data: shapeDataSchema }),
  z.object({ ...base, type: z.literal("GRAPH"), data: graphDataSchema }),
  z.object({ ...base, type: z.literal("IMAGE"), data: imageDataSchema }),
  z.object({ ...base, type: z.literal("AI_SOLUTION"), data: aiSolutionDataSchema }),
  z.object({ ...base, type: z.literal("SELECTION"), data: selectionDataSchema }),
]);

export type NotebookObject = z.infer<typeof notebookObjectSchema>;
export type InkObject = Extract<NotebookObject, { type: "INK" }>;
export type TextObject = Extract<NotebookObject, { type: "TEXT" }>;
export type EquationObject = Extract<NotebookObject, { type: "EQUATION" }>;
export type ShapeObject = Extract<NotebookObject, { type: "SHAPE" }>;
export type GraphObject = Extract<NotebookObject, { type: "GRAPH" }>;
export type AiSolutionObject = Extract<NotebookObject, { type: "AI_SOLUTION" }>;

/** Request body for batched, idempotent object saves. */
export const saveObjectsSchema = z.object({
  upserts: z.array(notebookObjectSchema).max(500),
  deletes: z.array(z.string().min(8).max(64)).max(2_000),
});
export type SaveObjectsInput = z.infer<typeof saveObjectsSchema>;

export const createNotebookSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled notebook"),
  folderId: z.string().nullable().optional(),
  pageType: z.enum(["BLANK", "RULED", "GRID"]).default("RULED"),
});

export const updateNotebookSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  folderId: z.string().nullable().optional(),
  defaultPageType: z.enum(["BLANK", "RULED", "GRID"]).optional(),
});

export const createPageSchema = z.object({
  pageType: z.enum(["BLANK", "RULED", "GRID"]).optional(),
  /** Insert after this 0-based position; appends when omitted. */
  afterPosition: z.number().int().min(-1).optional(),
});

export const updatePageSchema = z.object({
  pageType: z.enum(["BLANK", "RULED", "GRID"]).optional(),
  position: z.number().int().min(0).optional(),
});

export const folderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: color.nullable().optional(),
});
