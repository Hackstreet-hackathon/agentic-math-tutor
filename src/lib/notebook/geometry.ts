import type { InkObject, NotebookObject } from "./schemas";

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export const DEFAULT_PAGE = { width: 816, height: 1056 } as const;

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function boundsOf(o: Pick<NotebookObject, "x" | "y" | "width" | "height">): Rect {
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function normaliseRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Bounding box of a flat [x, y, ...] point list, padded by `pad`. */
export function pointsBounds(points: number[], pad = 0): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i] as number;
    const py = points[i + 1] as number;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance from a page-space point to an ink stroke's centre line. */
export function distanceToInk(p: Point, ink: InkObject): number {
  const pts = ink.data.points;
  const ox = ink.x;
  const oy = ink.y;
  if (pts.length < 4) {
    return Math.hypot(p.x - (ox + (pts[0] ?? 0)), p.y - (oy + (pts[1] ?? 0)));
  }
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const d = distanceToSegment(
      p,
      { x: ox + (pts[i] as number), y: oy + (pts[i + 1] as number) },
      { x: ox + (pts[i + 2] as number), y: oy + (pts[i + 3] as number) },
    );
    if (d < best) best = d;
  }
  return best;
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonFromFlat(flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i] as number, y: flat[i + 1] as number });
  return out;
}

/** Fraction (0..1) of an object's bounding box covered by the polygon, sampled on a grid. */
export function polygonCoverage(polygon: Point[], rect: Rect, samples = 6): number {
  if (rect.width <= 0 || rect.height <= 0) {
    return pointInPolygon({ x: rect.x, y: rect.y }, polygon) ? 1 : 0;
  }
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const p = { x: rect.x + ((i + 0.5) / samples) * rect.width, y: rect.y + ((j + 0.5) / samples) * rect.height };
      if (pointInPolygon(p, polygon)) hit++;
    }
  }
  return hit / (samples * samples);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Page units -> normalised 0..1 coordinates, used for stable references across zoom/export. */
export function toNormalised(r: Rect, page: { width: number; height: number }): [number, number, number, number] {
  return [r.x / page.width, r.y / page.height, (r.x + r.width) / page.width, (r.y + r.height) / page.height];
}

export function fromNormalised(b: readonly [number, number, number, number], page: { width: number; height: number }): Rect {
  return { x: b[0] * page.width, y: b[1] * page.height, width: (b[2] - b[0]) * page.width, height: (b[3] - b[1]) * page.height };
}
