import type { Rect } from "@/lib/notebook/geometry";
import { rectsIntersect } from "@/lib/notebook/geometry";
import { strokePathData } from "@/lib/notebook/ops";
import type { NotebookObject } from "@/lib/notebook/schemas";

const MAX_SIDE = 1100;
const MAX_CHARS = 1_400_000;

/**
 * Render the circled region as an image for vision-capable models: the PDF page pixels (if any)
 * plus the student's ink and shapes. Typed text/equations are sent as text instead.
 * Returns null when the region is degenerate.
 */
export function captureRegionImage(opts: {
  page: { width: number; height: number };
  bounds: Rect;
  objects: NotebookObject[];
  /** The rendered PDF page canvas, when this is a PDF page. */
  pdfCanvas?: HTMLCanvasElement | null;
}): string | null {
  const { page, objects, pdfCanvas } = opts;
  const pad = 16;
  const x = Math.max(0, opts.bounds.x - pad);
  const y = Math.max(0, opts.bounds.y - pad);
  const w = Math.min(page.width, opts.bounds.x + opts.bounds.width + pad) - x;
  const h = Math.min(page.height, opts.bounds.y + opts.bounds.height + pad) - y;
  if (w < 8 || h < 8) return null;

  let scale = Math.min(3, MAX_SIDE / Math.max(w, h));
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (pdfCanvas && pdfCanvas.width > 0) {
      const k = pdfCanvas.width / page.width;
      ctx.drawImage(pdfCanvas, x * k, y * k, w * k, h * k, 0, 0, canvas.width, canvas.height);
    }

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
    const region: Rect = { x, y, width: w, height: h };
    for (const o of objects) {
      if (!rectsIntersect(region, o)) continue;
      if (o.type === "INK") {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.globalAlpha = o.data.opacity;
        ctx.fillStyle = o.data.color;
        ctx.fill(new Path2D(strokePathData(o.data.points, o.data.pressures, o.data)));
        ctx.restore();
      } else if (o.type === "SHAPE") {
        ctx.save();
        ctx.strokeStyle = o.data.stroke;
        ctx.lineWidth = o.data.strokeWidth;
        ctx.beginPath();
        if (o.data.shape === "ellipse") ctx.ellipse(o.x + o.width / 2, o.y + o.height / 2, o.width / 2, o.height / 2, 0, 0, Math.PI * 2);
        else if (o.data.shape === "rect") ctx.rect(o.x, o.y, o.width, o.height);
        else {
          ctx.moveTo(o.data.flipX ? o.x + o.width : o.x, o.data.flipY ? o.y + o.height : o.y);
          ctx.lineTo(o.data.flipX ? o.x : o.x + o.width, o.data.flipY ? o.y : o.y + o.height);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

    const url = canvas.toDataURL("image/jpeg", 0.85);
    if (url.length <= MAX_CHARS) return url;
    scale *= 0.7; // too big: shrink and retry
  }
  return null;
}
