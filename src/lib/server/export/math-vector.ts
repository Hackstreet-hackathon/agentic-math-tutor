import svgpath from "svgpath";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/enclose/EncloseConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/cases/CasesConfiguration.js";
import "mathjax-full/js/input/tex/centernot/CenternotConfiguration.js";
import "mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js";

/**
 * Allowlisted TeX packages. Deliberately excludes `html` (\\href/\\class), `require`,
 * `noundefined` and `noerrors` (which would hide errors) since the input is untrusted.
 */
const PACKAGES = ["base", "ams", "newcommand", "boldsymbol", "cancel", "color", "enclose", "mathtools", "cases", "centernot", "gensymb"];

/**
 * Converts LaTeX into vector outlines (no raster, no fonts needed at render time) using
 * MathJax's SVG output with inlined glyph paths. The result is used to draw equations
 * into exported PDFs.
 */
export type PathCmd =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

export interface MathVector {
  /** Content box in MathJax units (1000 units = 1 em); y grows downward. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  paths: PathCmd[][];
}

type Matrix = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseTransform(attr: string | undefined): Matrix {
  let m = IDENTITY;
  if (!attr) return m;
  for (const t of attr.matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
    const a = (t[2] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some((n) => !Number.isFinite(n))) continue;
    if (t[1] === "translate") m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (t[1] === "scale") m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else if (a.length === 6) m = mul(m, a as Matrix);
  }
  return m;
}

const attr = (tag: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function pathToCommands(d: string, m: Matrix): PathCmd[] {
  const out: PathCmd[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const segs: (string | number)[][] = [];
  svgpath(d)
    .abs()
    .unshort()
    .unarc()
    .iterate((seg) => {
      segs.push(seg as (string | number)[]);
    });
  for (const seg of segs) {
    const c = seg[0] as string;
    const n = seg.slice(1) as number[];
    switch (c) {
      case "M":
        [cx, cy] = [n[0]!, n[1]!];
        [sx, sy] = [cx, cy];
        out.push(["M", ...apply(m, cx, cy)]);
        break;
      case "L":
        [cx, cy] = [n[0]!, n[1]!];
        out.push(["L", ...apply(m, cx, cy)]);
        break;
      case "H":
        cx = n[0]!;
        out.push(["L", ...apply(m, cx, cy)]);
        break;
      case "V":
        cy = n[0]!;
        out.push(["L", ...apply(m, cx, cy)]);
        break;
      case "C":
        out.push(["C", ...apply(m, n[0]!, n[1]!), ...apply(m, n[2]!, n[3]!), ...apply(m, n[4]!, n[5]!)]);
        [cx, cy] = [n[4]!, n[5]!];
        break;
      case "Q": {
        // quadratic -> cubic
        const [qx, qy, x, y] = n as [number, number, number, number];
        out.push([
          "C",
          ...apply(m, cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)),
          ...apply(m, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)),
          ...apply(m, x, y),
        ]);
        [cx, cy] = [x, y];
        break;
      }
      case "Z":
        out.push(["Z"]);
        [cx, cy] = [sx, sy];
        break;
    }
  }
  return out;
}

function rectToCommands(x: number, y: number, w: number, h: number, m: Matrix): PathCmd[] {
  return [
    ["M", ...apply(m, x, y)],
    ["L", ...apply(m, x + w, y)],
    ["L", ...apply(m, x + w, y + h)],
    ["L", ...apply(m, x, y + h)],
    ["Z"],
  ];
}

/** Parse MathJax's SVG output (inline glyph paths) into transformed vector commands. */
export function parseMathJaxSvg(svg: string): MathVector | null {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const vb = root && attr(root, "viewBox")?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return null;

  const paths: PathCmd[][] = [];
  const stack: Matrix[] = [IDENTITY];
  for (const tag of svg.matchAll(/<(\/?)(g|path|rect)\b([^>]*?)(\/?)>/g)) {
    const closing = tag[1] === "/";
    const name = tag[2];
    const body = tag[3] ?? "";
    const top = stack[stack.length - 1]!;
    if (name === "g") {
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else if (tag[4] === "/") {
        // empty self-closed group: nothing to draw
      } else {
        stack.push(mul(top, parseTransform(attr(body, "transform"))));
      }
    } else if (!closing && name === "path") {
      const d = attr(body, "d");
      if (d) paths.push(pathToCommands(d, mul(top, parseTransform(attr(body, "transform")))));
    } else if (!closing && name === "rect") {
      const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(attr(body, k) ?? 0)) as [number, number, number, number];
      paths.push(rectToCommands(x, y, w, h, mul(top, parseTransform(attr(body, "transform")))));
    }
  }
  return { minX: vb[0]!, minY: vb[1]!, width: vb[2]!, height: vb[3]!, paths };
}

let converter: ((latex: string) => string) | undefined;

function getConverter() {
  if (converter) return converter;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document("", { InputJax: new TeX({ packages: PACKAGES }), OutputJax: new SVG({ fontCache: "none" }) });
  converter = (latex) => adaptor.innerHTML(doc.convert(latex, { display: false }));
  return converter;
}

const cache = new Map<string, MathVector | null>();

/** LaTeX -> vector outlines, or null when MathJax cannot typeset it. */
export function latexToVector(latex: string): MathVector | null {
  const key = latex;
  if (cache.has(key)) return cache.get(key) ?? null;
  let result: MathVector | null = null;
  try {
    const svg = getConverter()(latex);
    // MathJax reports TeX errors as <merror> inside the svg; treat those as unrenderable.
    result = /data-mml-node="merror"/.test(svg) ? null : parseMathJaxSvg(svg);
  } catch {
    result = null;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
}
