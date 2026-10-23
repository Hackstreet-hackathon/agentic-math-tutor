import { rectsIntersect, type Rect } from "./geometry";

/**
 * Where to put an AI-generated solution so it never covers existing work.
 * Pure geometry: obstacles are student objects plus printed content measured from the page.
 */

export const SOLUTION_WIDTH = 520;
const MARGIN = 36;
const GAP = 10;

export type Placement = { kind: "free"; x: number; y: number } | { kind: "no-space" };

export interface PlacementInput {
  page: { width: number; height: number };
  obstacles: Rect[];
  /** The circled region / selected objects the answer belongs to, if any. */
  anchor: Rect | null;
  size: { width: number; height: number };
}

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });
const hits = (candidate: Rect, obstacles: Rect[]) => obstacles.some((o) => rectsIntersect(candidate, inflate(o, GAP)));

export function findFreeSpot({ page, obstacles, anchor, size }: PlacementInput): Placement {
  if (size.width > page.width - MARGIN * 2 || size.height > page.height - MARGIN * 2) return { kind: "no-space" };
  const maxX = page.width - MARGIN - size.width;
  const maxY = page.height - MARGIN - size.height;
  const step = 8;

  const xs: number[] = [];
  const preferX = Math.min(Math.max(anchor?.x ?? MARGIN, MARGIN), maxX);
  xs.push(preferX);
  if (preferX !== MARGIN) xs.push(MARGIN);
  if (anchor) {
    const right = anchor.x + anchor.width + GAP * 2;
    if (right <= maxX) xs.push(right);
  }

  const startBelow = anchor ? anchor.y + anchor.height + GAP * 1.5 : MARGIN;
  const tryColumn = (x: number, from: number, to: number): number | null => {
    for (let y = from; y <= to; y += step) if (!hits({ x, y, ...size }, obstacles)) return y;
    return null;
  };

  // Prefer directly below the question, nearest first; then anywhere above it.
  for (const x of xs) {
    const y = tryColumn(x, Math.max(MARGIN, startBelow), maxY);
    if (y !== null) return { kind: "free", x, y };
  }
  if (anchor) {
    for (const x of xs) {
      const y = tryColumn(x, MARGIN, Math.min(maxY, anchor.y - size.height - GAP));
      if (y !== null) return { kind: "free", x, y };
    }
  }
  return { kind: "no-space" };
}

export function estimateSolutionHeight(
  sol: { steps: { latex: string | null; explanation: string }[]; finalAnswer?: string | null },
  width: number,
): number {
  const charsPerLine = Math.max(20, Math.floor((width - 32) / 6.6));
  let h = 20 /* padding */ + 22 /* header */;
  for (const s of sol.steps) {
    if (s.latex) h += 34;
    if (s.explanation) h += Math.ceil(s.explanation.length / charsPerLine) * 17;
    h += 8;
  }
  if (sol.finalAnswer) h += 40;
  return Math.ceil(h);
}

/**
 * Occupied rectangles from rendered page pixels (RGBA), on a coarse grid. Works for digital and
 * scanned PDFs alike because it measures what is actually drawn.
 */
export function occupancyRects(rgba: Uint8ClampedArray, cols: number, rows: number, cell: number, threshold = 238): Rect[] {
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    let runStart = -1;
    for (let c = 0; c <= cols; c++) {
      const occupied = c < cols && luminance(rgba, (r * cols + c) * 4) < threshold;
      if (occupied && runStart < 0) runStart = c;
      if (!occupied && runStart >= 0) {
        rects.push({ x: runStart * cell, y: r * cell, width: (c - runStart) * cell, height: cell });
        runStart = -1;
      }
    }
  }
  // merge vertically adjacent runs with identical x-extent
  const merged: Rect[] = [];
  for (const rc of rects) {
    const prev = merged.find((m) => m.x === rc.x && m.width === rc.width && m.y + m.height === rc.y);
    if (prev) prev.height += rc.height;
    else merged.push({ ...rc });
  }
  return merged;
}

const luminance = (d: Uint8ClampedArray, i: number) => (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) * (d[i + 3]! / 255) + 255 * (1 - d[i + 3]! / 255);
