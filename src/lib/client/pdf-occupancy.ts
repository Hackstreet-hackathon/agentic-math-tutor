import type { Rect } from "@/lib/notebook/geometry";
import { occupancyRects } from "@/lib/notebook/placement";

const CELL = 8;

/**
 * Measure what is actually printed on the rendered PDF page, as rectangles in page units.
 * Used to keep inserted solutions off printed content (digital and scanned pages alike).
 */
export function measurePdfObstacles(page: { width: number; height: number }): Rect[] {
  const source = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-background"] canvas');
  if (!source || source.width === 0) return [];
  const cols = Math.ceil(page.width / CELL);
  const rows = Math.ceil(page.height / CELL);
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cols, rows);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, cols, rows);
  return occupancyRects(ctx.getImageData(0, 0, cols, rows).data, cols, rows, CELL);
}
