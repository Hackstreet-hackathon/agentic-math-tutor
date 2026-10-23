import {
  appendBezierCurve,
  closePath,
  degrees,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  StandardFonts,
  LineCapStyle,
  LineJoinStyle,
} from "pdf-lib";
import { strokeOutline } from "@/lib/notebook/ops";
import type { NotebookObject } from "@/lib/notebook/schemas";
import { latexToVector } from "./math-vector";

/**
 * Builds an annotated copy of a notebook as a PDF.
 *
 * - Original PDF pages are *copied* (content streams untouched) and annotations are drawn
 *   on top; the stored original file is never modified.
 * - Notebook pages become Letter-sized pages (816 px -> 612 pt, scale 0.75).
 * - Annotation coordinates are viewport coordinates (top-left origin, after page rotation);
 *   `Painter` maps them into PDF user space for any /Rotate.
 */

export interface ExportPage {
  pageType: "BLANK" | "RULED" | "GRID" | "PDF";
  width: number;
  height: number;
  /** Source PDF bytes provider for PDF pages. */
  source?: { key: string; pdfPageNumber: number };
  objects: NotebookObject[];
}

export interface ExportResult {
  bytes: Uint8Array;
  /** Objects that could not be drawn (e.g. types not yet exportable). */
  skipped: number;
}

const NOTEBOOK_SCALE = 0.75;

export async function buildAnnotatedPdf(
  title: string,
  pages: ExportPage[],
  loadSource: (key: string) => Promise<Uint8Array>,
): Promise<ExportResult> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setProducer("Math Notebook");
  out.setCreator("Math Notebook");

  const sources = new Map<string, PDFDocument>();
  const fonts = new FontCache(out);
  let skipped = 0;

  for (const p of pages) {
    let page: PDFPage;
    let painter: Painter;

    if (p.pageType === "PDF" && p.source) {
      let src = sources.get(p.source.key);
      if (!src) {
        src = await PDFDocument.load(await loadSource(p.source.key), { ignoreEncryption: true, updateMetadata: false });
        sources.set(p.source.key, src);
      }
      const index = p.source.pdfPageNumber - 1;
      if (index < 0 || index >= src.getPageCount()) throw new Error("Page missing from source PDF");
      const [copied] = await out.copyPages(src, [index]);
      if (!copied) throw new Error("Could not copy source page");
      page = out.addPage(copied);
      const crop = page.getCropBox();
      painter = new Painter(page, { x0: crop.x, y0: crop.y, w: crop.width, h: crop.height, rotation: normaliseRotation(page.getRotation().angle), scale: 1 });
    } else {
      page = out.addPage([p.width * NOTEBOOK_SCALE, p.height * NOTEBOOK_SCALE]);
      painter = new Painter(page, { x0: 0, y0: 0, w: p.width * NOTEBOOK_SCALE, h: p.height * NOTEBOOK_SCALE, rotation: 0, scale: NOTEBOOK_SCALE });
      drawBackground(painter, p.pageType, p.width, p.height);
    }

    const ordered = [...p.objects].sort((a, b) => a.zIndex - b.zIndex);
    for (const o of ordered) {
      const ok = await drawObject(painter, fonts, o);
      if (!ok) skipped++;
    }
  }
  return { bytes: await out.save(), skipped };
}

/* ---------- coordinate mapping + low-level drawing ---------- */

export interface PageGeometry {
  x0: number;
  y0: number;
  w: number;
  h: number;
  rotation: 0 | 90 | 180 | 270;
  /** Viewport units -> points. */
  scale: number;
}

function normaliseRotation(angle: number): 0 | 90 | 180 | 270 {
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return a as 0 | 90 | 180 | 270;
}

type Pt = [number, number];

/**
 * Map a point in the on-screen page (top-left origin, y down, *after* /Rotate) to PDF user
 * space (bottom-left origin, y up, *before* /Rotate). `g.w/h` are the unrotated crop-box size.
 */
export function viewportToUser(g: PageGeometry, vx: number, vy: number): Pt {
  const { x0, y0, w, h, rotation, scale } = g;
  const x = vx * scale;
  const y = vy * scale;
  switch (rotation) {
    case 0:
      return [x0 + x, y0 + h - y];
    case 90:
      return [x0 + y, y0 + x];
    case 180:
      return [x0 + w - x, y0 + y];
    case 270:
      return [x0 + w - y, y0 + h - x];
  }
}

class Painter {
  private gs = new Map<number, ReturnType<PDFPage["node"]["newExtGState"]>>();
  constructor(
    public page: PDFPage,
    private g: PageGeometry,
  ) {}

  get rotation() {
    return this.g.rotation;
  }
  get scale() {
    return this.g.scale;
  }

  /** Viewport (top-left, y down) -> PDF user space. */
  toUser(vx: number, vy: number): Pt {
    return viewportToUser(this.g, vx, vy);
  }

  private begin(color: string, opacity: number, kind: "fill" | "stroke", lineWidth?: number) {
    const ops = [pushGraphicsState()];
    if (opacity < 1) {
      let name = this.gs.get(opacity);
      if (!name) {
        const dict = this.page.doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity });
        name = this.page.node.newExtGState("GS", dict);
        this.gs.set(opacity, name);
      }
      ops.push(setGraphicsState(name));
    }
    const c = hexToRgb(color);
    ops.push(kind === "fill" ? setFillingColor(c) : setStrokingColor(c));
    if (kind === "stroke") ops.push(setLineWidth((lineWidth ?? 1) * this.g.scale), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
    this.page.pushOperators(...ops);
  }

  private end() {
    this.page.pushOperators(popGraphicsState());
  }

  fillPolygon(points: Pt[], color: string, opacity = 1) {
    if (points.length < 3) return;
    this.begin(color, opacity, "fill");
    const [first, ...rest] = points.map(([x, y]) => this.toUser(x, y));
    this.page.pushOperators(moveTo(first![0], first![1]), ...rest.map(([x, y]) => lineTo(x, y)), closePath(), fill());
    this.end();
  }

  strokePolyline(points: Pt[], color: string, width: number, opacity = 1, closed = false) {
    if (points.length < 2) return;
    this.begin(color, opacity, "stroke", width);
    const [first, ...rest] = points.map(([x, y]) => this.toUser(x, y));
    this.page.pushOperators(moveTo(first![0], first![1]), ...rest.map(([x, y]) => lineTo(x, y)));
    if (closed) this.page.pushOperators(closePath());
    this.page.pushOperators(stroke());
    this.end();
  }

  /** Fill cubic-bezier outlines given in viewport coordinates. */
  fillCurves(paths: ({ cmd: "M" | "L" | "Z" | "C"; p: number[] })[][], color: string, opacity = 1) {
    this.begin(color, opacity, "fill");
    for (const path of paths) {
      const ops = path.map(({ cmd, p }) => {
        if (cmd === "M") return moveTo(...this.toUser(p[0]!, p[1]!));
        if (cmd === "L") return lineTo(...this.toUser(p[0]!, p[1]!));
        if (cmd === "C") {
          const a = this.toUser(p[0]!, p[1]!);
          const b = this.toUser(p[2]!, p[3]!);
          const c = this.toUser(p[4]!, p[5]!);
          return appendBezierCurve(a[0], a[1], b[0], b[1], c[0], c[1]);
        }
        return closePath();
      });
      // One fill per glyph path keeps holes (opposite winding) within each outline.
      this.page.pushOperators(...ops, fill());
    }
    this.end();
  }

  strokeAndFill(points: Pt[], strokeColor: string, fillColor: string, width: number) {
    this.begin(strokeColor, 1, "stroke", width);
    this.page.pushOperators(setFillingColor(hexToRgb(fillColor)));
    const [first, ...rest] = points.map(([x, y]) => this.toUser(x, y));
    this.page.pushOperators(moveTo(first![0], first![1]), ...rest.map(([x, y]) => lineTo(x, y)), closePath(), fillAndStroke());
    this.end();
  }

  text(str: string, vx: number, vy: number, font: PDFFont, sizePx: number, color: string) {
    const [x, y] = this.toUser(vx, vy);
    this.page.drawText(str, { x, y, font, size: sizePx * this.g.scale, color: hexToRgb(color), rotate: degrees(this.g.rotation) });
  }
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").slice(0, 6);
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

class FontCache {
  private cache = new Map<string, Promise<PDFFont>>();
  constructor(private doc: PDFDocument) {}
  get(family: "sans" | "serif" | "hand" | "mono"): Promise<PDFFont> {
    const name = family === "serif" ? StandardFonts.TimesRoman : family === "mono" ? StandardFonts.Courier : family === "hand" ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
    let f = this.cache.get(name);
    if (!f) {
      f = this.doc.embedFont(name);
      this.cache.set(name, f);
    }
    return f;
  }
}

/* ---------- page background ---------- */

function drawBackground(p: Painter, type: ExportPage["pageType"], w: number, h: number) {
  if (type === "RULED") {
    for (let y = 8 + 31.5; y < h; y += 32) p.strokePolyline([[0, y], [w, y]], "#cfd8ee", 1);
    p.strokePolyline([[79.5, 0], [79.5, h]], "#f0a4a4", 1);
  } else if (type === "GRID") {
    for (let x = 0.5; x < w; x += 24) p.strokePolyline([[x, 0], [x, h]], "#dfe5f2", 1);
    for (let y = 0.5; y < h; y += 24) p.strokePolyline([[0, y], [w, y]], "#dfe5f2", 1);
  }
}

/* ---------- objects ---------- */

async function drawObject(p: Painter, fonts: FontCache, o: NotebookObject): Promise<boolean> {
  switch (o.type) {
    case "INK": {
      const outline = strokeOutline(o.data.points, o.data.pressures, o.data);
      p.fillPolygon(outline.map(([x, y]) => [o.x + x!, o.y + y!] as Pt), o.data.color, o.data.opacity);
      return true;
    }
    case "SHAPE":
      drawShape(p, o);
      return true;
    case "TEXT":
      await drawText(p, fonts, o);
      return true;
    case "EQUATION":
      return drawEquation(p, o);
    case "AI_SOLUTION":
      await drawSolution(p, fonts, o);
      return true;
    default:
      // GRAPH / IMAGE / SELECTION are exported once those object types ship.
      return o.type === "SELECTION";
  }
}

function drawShape(p: Painter, o: Extract<NotebookObject, { type: "SHAPE" }>) {
  const { x, y, width: w, height: h } = o;
  const { shape, stroke: color, strokeWidth, fill: fillColor, flipX, flipY } = o.data;
  if (shape === "rect") {
    const pts: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    if (fillColor) p.strokeAndFill(pts, color, fillColor, strokeWidth);
    else p.strokePolyline(pts, color, strokeWidth, 1, true);
  } else if (shape === "ellipse") {
    const pts: Pt[] = Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      return [x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)] as Pt;
    });
    if (fillColor) p.strokeAndFill(pts, color, fillColor, strokeWidth);
    else p.strokePolyline(pts, color, strokeWidth, 1, true);
  } else {
    const a: Pt = [flipX ? x + w : x, flipY ? y + h : y];
    const b: Pt = [flipX ? x : x + w, flipY ? y : y + h];
    p.strokePolyline([a, b], color, strokeWidth);
    if (shape === "arrow") {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = 10 + strokeWidth;
      const half = (8 + strokeWidth) / 2;
      const base: Pt = [b[0] - Math.cos(ang) * len, b[1] - Math.sin(ang) * len];
      const nx = -Math.sin(ang) * half;
      const ny = Math.cos(ang) * half;
      p.fillPolygon([b, [base[0] + nx, base[1] + ny], [base[0] - nx, base[1] - ny]], color);
    }
  }
}

/** Replace characters the standard PDF fonts cannot encode so drawing never throws. */
function encodable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text) out += supported.has(ch.codePointAt(0)!) || ch === "\n" ? ch : "?";
  return out;
}

async function drawText(p: Painter, fonts: FontCache, o: Extract<NotebookObject, { type: "TEXT" }>) {
  const font = await fonts.get(o.data.fontFamily);
  const size = o.data.fontSize;
  const lineHeight = size * 1.35;
  const text = encodable(font, o.data.text);
  const lines: string[] = [];
  const widthOf = (s: string) => font.widthOfTextAtSize(s, size);
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && widthOf(candidate) > o.width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  lines.forEach((l, i) => {
    if (l) p.text(l, o.x, o.y + i * lineHeight + size * 1.08, font, size, o.data.color);
  });
}

/** Draw typeset math (MathJax vector outlines) with its top-left corner at (x, y). Returns the drawn height. */
function drawVector(p: Painter, latex: string, x: number, y: number, fontSize: number, color: string): { ok: boolean; height: number } {
  const vec = latexToVector(latex);
  if (!vec) return { ok: false, height: fontSize * 1.3 };
  const k = fontSize / 1000; // MathJax: 1000 units per em
  const ox = x - vec.minX * k;
  const oy = y - vec.minY * k;
  p.fillCurves(
    vec.paths.map((path) =>
      path.map((c) => {
        if (c[0] === "Z") return { cmd: "Z" as const, p: [] };
        if (c[0] === "C") return { cmd: "C" as const, p: [ox + c[1] * k, oy + c[2] * k, ox + c[3] * k, oy + c[4] * k, ox + c[5] * k, oy + c[6] * k] };
        return { cmd: c[0], p: [ox + c[1] * k, oy + c[2] * k] };
      }),
    ),
    color,
  );
  return { ok: true, height: vec.height * k };
}

/** Equations are exported as vector outlines (MathJax), not images. */
function drawEquation(p: Painter, o: Extract<NotebookObject, { type: "EQUATION" }>): boolean {
  return drawVector(p, o.data.latex, o.x, o.y, o.data.fontSize, o.data.color).ok;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/** AI-written solution card: tinted panel with an accent bar, label, typeset steps and the answer. */
async function drawSolution(p: Painter, fonts: FontCache, o: Extract<NotebookObject, { type: "AI_SOLUTION" }>) {
  const font = await fonts.get("sans");
  const pad = 10;
  const innerX = o.x + pad + 6;
  const innerW = o.width - pad * 2 - 6;
  const ops: (() => void)[] = [];
  let y = o.y + pad;

  const labelY = y;
  ops.push(() => p.text("AI SOLUTION", innerX, labelY + 9, font, 9, "#3b5bdb"));
  y += 20;

  for (const s of o.data.steps) {
    if (s.latex) {
      const yy = y;
      const probe = latexToVector(s.latex);
      const h = probe ? (probe.height * 17) / 1000 : 17;
      ops.push(() => {
        if (!drawVector(p, s.latex, innerX, yy, 17, "#1c1b1a").ok) p.text(encodable(font, s.latex), innerX, yy + 13, font, 11, "#1c1b1a");
      });
      y += h + 5;
    }
    if (s.explanation) {
      const lines = wrapLines(font, encodable(font, s.explanation.replace(/\$/g, "")), 11, innerW);
      lines.forEach((l, i) => {
        const yy = y + i * 15;
        if (l) ops.push(() => p.text(l, innerX, yy + 11, font, 11, "#6b6965"));
      });
      y += lines.length * 15;
    }
    y += 6;
  }
  if (o.data.finalAnswer) {
    const yy = y + 2;
    const fa = o.data.finalAnswer;
    ops.push(() => {
      p.text("ANSWER", innerX, yy + 13, font, 8, "#6b6965");
      if (!drawVector(p, fa, innerX + 44, yy + 3, 17, "#1c1b1a").ok) p.text(encodable(font, fa), innerX + 44, yy + 13, font, 11, "#1c1b1a");
    });
    y += 28;
  }
  const height = Math.max(o.height, y - o.y + pad);

  // background first, then content
  p.fillPolygon([[o.x, o.y], [o.x + o.width, o.y], [o.x + o.width, o.y + height], [o.x, o.y + height]], "#eef1ff", 0.85);
  p.fillPolygon([[o.x, o.y], [o.x + 4, o.y], [o.x + 4, o.y + height], [o.x, o.y + height]], "#3b5bdb");
  for (const op of ops) op();
}
