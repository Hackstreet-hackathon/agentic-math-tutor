import { getStroke } from "perfect-freehand";
import {
  boundsOf,
  distanceToInk,
  pointInPolygon,
  pointsBounds,
  polygonCoverage,
  rectsIntersect,
  unionRects,
  type Point,
  type Rect,
} from "./geometry";
import type { InkObject, NotebookObject } from "./schemas";

/* ---------- history primitives ---------- */

/** One object's before/after state; `null` means "did not exist". */
export interface Change {
  before: NotebookObject | null;
  after: NotebookObject | null;
}

export function applyChanges(objects: NotebookObject[], changes: Change[]): NotebookObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const order = objects.map((o) => o.id);
  for (const c of changes) {
    const id = (c.after ?? c.before)?.id;
    if (!id) continue;
    if (c.after) {
      if (!byId.has(id)) order.push(id);
      byId.set(id, c.after);
    } else {
      byId.delete(id);
    }
  }
  return order.filter((id) => byId.has(id)).map((id) => byId.get(id) as NotebookObject);
}

export const invertChanges = (changes: Change[]): Change[] =>
  changes.map((c) => ({ before: c.after, after: c.before })).reverse();

/* ---------- ink ---------- */

export interface InkStyle {
  tool: "pen" | "pencil" | "highlighter";
  color: string;
  size: number;
  opacity: number;
}

export function inkStyleFor(tool: InkStyle["tool"], color: string, size: number): InkStyle {
  if (tool === "highlighter") return { tool, color, size: size * 3, opacity: 0.35 };
  if (tool === "pencil") return { tool, color, size: Math.max(1, size * 0.8), opacity: 0.8 };
  return { tool, color, size, opacity: 1 };
}

export interface RawStroke {
  /** Page-space points. */
  points: Point[];
  pressures: number[];
  times: number[];
  hasPressure: boolean;
}

export function makeInk(id: string, stroke: RawStroke, style: InkStyle, zIndex: number): InkObject {
  const flat: number[] = [];
  for (const p of stroke.points) flat.push(p.x, p.y);
  if (stroke.points.length === 1) flat.push(stroke.points[0]!.x, stroke.points[0]!.y);
  const pad = style.size / 2 + 1;
  const b = pointsBounds(flat, pad);
  const rel = flat.map((v, i) => round(v - (i % 2 === 0 ? b.x : b.y)));
  const n = rel.length / 2;
  const pressures = stroke.hasPressure ? padTo(stroke.pressures.map((p) => round(p, 3)), n) : undefined;
  return {
    id,
    type: "INK",
    source: "USER",
    x: round(b.x),
    y: round(b.y),
    width: round(b.width),
    height: round(b.height),
    rotation: 0,
    zIndex,
    linkedToId: null,
    metadata: null,
    data: {
      ...style,
      points: rel,
      pressures,
      times: padTo(stroke.times.map((t) => Math.round(t)), n),
    },
  };
}

function padTo(arr: number[], n: number): number[] {
  if (arr.length === n) return arr;
  if (arr.length > n) return arr.slice(0, n);
  const last = arr[arr.length - 1] ?? 0;
  return arr.concat(Array<number>(n - arr.length).fill(last));
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Polygon outline of an ink stroke (shared by the canvas renderer, live preview and PDF export). */
export function strokeOutline(
  flat: number[],
  pressures: number[] | undefined,
  style: Pick<InkStyle, "tool" | "size">,
): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const p = pressures?.[i / 2];
    pts.push(p === undefined ? [flat[i]!, flat[i + 1]!] : [flat[i]!, flat[i + 1]!, p]);
  }
  const highlighter = style.tool === "highlighter";
  return getStroke(pts, {
    size: style.size,
    thinning: highlighter ? 0 : style.tool === "pencil" ? 0.3 : 0.5,
    smoothing: 0.6,
    streamline: 0.4,
    simulatePressure: pressures === undefined && !highlighter,
    last: true,
  });
}

/** SVG path data for an ink stroke. */
export function strokePathData(flat: number[], pressures: number[] | undefined, style: Pick<InkStyle, "tool" | "size">): string {
  return outlineToPath(strokeOutline(flat, pressures, style));
}

function outlineToPath(points: number[][]): string {
  if (points.length < 2) return "";
  let d = `M${f(points[0]![0]!)},${f(points[0]![1]!)}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i]!;
    const p1 = points[(i + 1) % points.length]!;
    d += `Q${f(p0[0]!)},${f(p0[1]!)} ${f((p0[0]! + p1[0]!) / 2)},${f((p0[1]! + p1[1]!) / 2)}`;
  }
  return d + "Z";
}
const f = (n: number) => n.toFixed(2);

/* ---------- hit testing ---------- */

/** Does a point (with tolerance, in page units) touch this object? Used by eraser and click-select. */
export function hitsObject(o: NotebookObject, p: Point, tolerance: number): boolean {
  if (o.type === "INK") {
    return distanceToInk(p, o) <= tolerance + o.data.size / 2;
  }
  const b = boundsOf(o);
  const inflated: Rect = { x: b.x - tolerance, y: b.y - tolerance, width: b.width + tolerance * 2, height: b.height + tolerance * 2 };
  if (!(p.x >= inflated.x && p.x <= inflated.x + inflated.width && p.y >= inflated.y && p.y <= inflated.y + inflated.height)) {
    return false;
  }
  if (o.type === "SHAPE" && o.data.fill === null && (o.data.shape === "rect" || o.data.shape === "ellipse")) {
    // Hollow shapes are hit on their outline, not their interior.
    return nearShapeOutline(o, p, tolerance + o.data.strokeWidth);
  }
  if (o.type === "SHAPE" && (o.data.shape === "line" || o.data.shape === "arrow")) {
    return nearShapeOutline(o, p, tolerance + o.data.strokeWidth);
  }
  return true;
}

function nearShapeOutline(o: Extract<NotebookObject, { type: "SHAPE" }>, p: Point, tol: number): boolean {
  const { x, y, width: w, height: h } = o;
  if (o.data.shape === "rect") {
    const dx = Math.min(Math.abs(p.x - x), Math.abs(p.x - (x + w)));
    const dy = Math.min(Math.abs(p.y - y), Math.abs(p.y - (y + h)));
    const insideX = p.x >= x - tol && p.x <= x + w + tol;
    const insideY = p.y >= y - tol && p.y <= y + h + tol;
    return (insideY && dx <= tol) || (insideX && dy <= tol);
  }
  if (o.data.shape === "ellipse") {
    const rx = Math.max(w / 2, 0.001);
    const ry = Math.max(h / 2, 0.001);
    const nx = (p.x - (x + rx)) / rx;
    const ny = (p.y - (y + ry)) / ry;
    const r = Math.hypot(nx, ny);
    return Math.abs(r - 1) * Math.min(rx, ry) <= tol;
  }
  const a = { x: o.data.flipX ? x + w : x, y: o.data.flipY ? y + h : y };
  const b = { x: o.data.flipX ? x : x + w, y: o.data.flipY ? y : y + h };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= tol;
}

/** Topmost object under the point, or null. */
export function pickTop(objects: NotebookObject[], p: Point, tolerance: number): NotebookObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (hitsObject(o, p, tolerance)) return o;
  }
  return null;
}

export function objectsInRect(objects: NotebookObject[], r: Rect): NotebookObject[] {
  return objects.filter((o) => rectsIntersect(boundsOf(o), r));
}

/**
 * Objects the user meant to include when drawing a lasso/circle. The circle need not be
 * perfect: an object counts when most of it is inside (ink: most of its points).
 */
export function objectsInLasso(objects: NotebookObject[], polygon: Point[], minCoverage = 0.5): NotebookObject[] {
  if (polygon.length < 3) return [];
  const polyBounds = unionRects([pointsBoundsRect(polygon)]);
  return objects.filter((o) => {
    const b = boundsOf(o);
    if (polyBounds && !rectsIntersect(polyBounds, b)) return false;
    if (o.type === "INK") {
      // Sample along the path (not just the recorded points) so sparse long segments count by length.
      const samples = sampleInk(o, 6);
      let inside = 0;
      for (const s of samples) if (pointInPolygon(s, polygon)) inside++;
      return samples.length > 0 && inside / samples.length >= minCoverage;
    }
    return polygonCoverage(polygon, b) >= minCoverage;
  });
}

/** Page-space points along an ink stroke, at most `spacing` units apart. */
export function sampleInk(o: InkObject, spacing: number): Point[] {
  const pts = o.data.points;
  const out: Point[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const cur = { x: o.x + pts[i]!, y: o.y + pts[i + 1]! };
    if (i + 3 < pts.length) {
      const nx = o.x + pts[i + 2]!;
      const ny = o.y + pts[i + 3]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(nx - cur.x, ny - cur.y) / spacing));
      for (let k = 0; k < steps; k++) out.push({ x: cur.x + ((nx - cur.x) * k) / steps, y: cur.y + ((ny - cur.y) * k) / steps });
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function pointsBoundsRect(poly: Point[]): Rect {
  const flat: number[] = [];
  for (const p of poly) flat.push(p.x, p.y);
  return pointsBounds(flat);
}

export function boundsOfObjects(objects: NotebookObject[]): Rect | null {
  return unionRects(objects.map(boundsOf));
}

/* ---------- move / resize ---------- */

export function moveObject(o: NotebookObject, dx: number, dy: number): NotebookObject {
  return { ...o, x: round(o.x + dx), y: round(o.y + dy) };
}

/** Map an object from one group bounding box to another (resize handles on a multi-selection). */
export function transformObject(o: NotebookObject, from: Rect, to: Rect): NotebookObject {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  const nx = round(to.x + (o.x - from.x) * sx);
  const ny = round(to.y + (o.y - from.y) * sy);
  const nw = Math.max(1, round(o.width * sx));
  const nh = Math.max(1, round(o.height * sy));
  switch (o.type) {
    case "INK": {
      const points = o.data.points.map((v, i) => round(v * (i % 2 === 0 ? sx : sy)));
      return { ...o, x: nx, y: ny, width: nw, height: nh, data: { ...o.data, points } };
    }
    case "EQUATION":
      return {
        ...o,
        x: nx,
        y: ny,
        data: { ...o.data, fontSize: Math.min(200, Math.max(8, round(o.data.fontSize * Math.min(sx, sy) || o.data.fontSize))) },
      };
    case "TEXT":
      // Resizing sets the wrap width; height is re-measured by the renderer.
      return { ...o, x: nx, y: ny, width: Math.max(40, nw) };
    case "SHAPE":
    case "GRAPH":
    case "IMAGE":
    case "SELECTION":
    case "AI_SOLUTION":
      return { ...o, x: nx, y: ny, width: Math.max(8, nw), height: Math.max(8, nh) };
  }
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function resizeBounds(b: Rect, handle: Handle, p: Point, keepAspect: boolean, min = 12): Rect {
  let left = b.x;
  let top = b.y;
  let right = b.x + b.width;
  let bottom = b.y + b.height;
  if (handle.includes("w")) left = Math.min(p.x, right - min);
  if (handle.includes("e")) right = Math.max(p.x, left + min);
  if (handle.includes("n")) top = Math.min(p.y, bottom - min);
  if (handle.includes("s")) bottom = Math.max(p.y, top + min);
  if (keepAspect && b.width > 0 && b.height > 0 && handle.length === 2) {
    const ratio = b.width / b.height;
    const w = right - left;
    const h = bottom - top;
    if (w / h > ratio) {
      const nh = w / ratio;
      if (handle.includes("n")) top = bottom - nh;
      else bottom = top + nh;
    } else {
      const nw = h * ratio;
      if (handle.includes("w")) left = right - nw;
      else right = left + nw;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function nextZ(objects: NotebookObject[]): number {
  let z = 0;
  for (const o of objects) if (o.zIndex > z) z = o.zIndex;
  return z + 1;
}
