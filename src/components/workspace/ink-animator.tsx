"use client";
import { useEffect, useMemo, useRef } from "react";
import { LATEX_CHAR_MAP, SYMBOL_MAP, type SymbolDef } from "@/lib/notebook/stroke-library";

interface InkAnimatorProps {
  /** LaTeX-like string to animate writing (simple chars + \pi etc.) */
  text: string;
  /** Width in px */
  width: number;
  /** Height in px */
  height: number;
  /** Ink color */
  color?: string;
  /** ms per stroke */
  strokeDuration?: number;
  /** Called when animation finishes */
  onDone?: () => void;
  className?: string;
}

interface SymbolLayout {
  def: SymbolDef;
  /** Pixel bounding box for this symbol */
  box: { x: number; y: number; w: number; h: number };
}

/** Parse text into an array of SymbolDef entries, resolving LaTeX escapes. */
function parseText(text: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  let i = 0;
  while (i < text.length) {
    // Try to match a LaTeX escape (e.g. \pi, \times)
    if (text[i] === "\\") {
      let matched = false;
      for (const [escape, char] of Object.entries(LATEX_CHAR_MAP)) {
        if (text.startsWith(escape, i)) {
          const def = SYMBOL_MAP.get(char);
          if (def) defs.push(def);
          i += escape.length;
          matched = true;
          break;
        }
      }
      if (!matched) i++; // skip unknown backslash sequence char
    } else {
      const char = text[i]!;
      const def = SYMBOL_MAP.get(char);
      if (def) defs.push(def);
      i++;
    }
  }
  return defs;
}

/** Convert a flat [x0,y0,...] array scaled to a box into an SVG path string. */
function toSvgPath(pts: number[], box: { x: number; y: number; w: number; h: number }): string {
  if (pts.length < 4) return "";
  const px = (v: number) => box.x + v * box.w;
  const py = (v: number) => box.y + v * box.h;
  let d = `M ${px(pts[0]!).toFixed(2)} ${py(pts[1]!).toFixed(2)}`;
  for (let i = 2; i < pts.length; i += 2) {
    d += ` L ${px(pts[i]!).toFixed(2)} ${py(pts[i + 1]!).toFixed(2)}`;
  }
  return d;
}

export function InkAnimator({ text, width, height, color = "#1e40af", strokeDuration = 300, onDone, className }: InkAnimatorProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Parse symbols and compute layout
  const layout = useMemo<SymbolLayout[]>(() => {
    const defs = parseText(text);
    if (defs.length === 0) return [];

    const symbolHeight = height * 0.85;
    const margin = (height - symbolHeight) / 2;
    const spacing = symbolHeight * 0.1;

    // Compute total width needed
    const totalWidth = defs.reduce((sum, def) => sum + def.aspect * symbolHeight + spacing, 0) - spacing;
    // Scale down if needed
    const scaleX = totalWidth > width * 0.95 ? (width * 0.95) / totalWidth : 1;

    const result: SymbolLayout[] = [];
    let curX = (width - totalWidth * scaleX) / 2;

    for (const def of defs) {
      const w = def.aspect * symbolHeight * scaleX;
      const h = symbolHeight;
      result.push({
        def,
        box: { x: curX, y: margin, w, h },
      });
      curX += w + spacing * scaleX;
    }
    return result;
  }, [text, width, height]);

  // Build all strokes with their delays
  const strokes = useMemo(() => {
    const all: { path: string; delay: number }[] = [];
    let delay = 0;
    for (const sym of layout) {
      for (const strokePts of sym.def.strokes) {
        all.push({ path: toSvgPath(strokePts, sym.box), delay });
        delay += strokeDuration;
      }
    }
    return all;
  }, [layout, strokeDuration]);

  const totalDuration = strokes.length > 0 ? (strokes.length - 1) * strokeDuration + strokeDuration : 0;

  // Animate via SVG stroke-dashoffset and call onDone after completion
  useEffect(() => {
    if (strokes.length === 0) {
      onDone?.();
      return;
    }

    const svg = svgRef.current;
    if (!svg) return;

    const paths = svg.querySelectorAll<SVGPathElement>("path[data-stroke-idx]");

    // Reset all paths to hidden
    paths.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
      p.style.transition = "none";
    });

    // Force reflow
    void svg.getBoundingClientRect();

    // Animate each path
    const timers: ReturnType<typeof setTimeout>[] = [];

    paths.forEach((p) => {
      const idx = Number(p.getAttribute("data-stroke-idx"));
      const stroke = strokes[idx];
      if (!stroke) return;

      const len = p.getTotalLength();
      const t = setTimeout(() => {
        p.style.transition = `stroke-dashoffset ${strokeDuration}ms ease-in-out`;
        p.style.strokeDashoffset = "0";
      }, stroke.delay);
      timers.push(t);
    });

    // Call onDone after all animations complete
    const doneTimer = setTimeout(() => {
      onDone?.();
    }, totalDuration + 50);
    timers.push(doneTimer);

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [strokes, strokeDuration, totalDuration, onDone]);

  if (strokes.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      {strokes.map((stroke, idx) => (
        <path
          key={idx}
          data-stroke-idx={idx}
          d={stroke.path}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </svg>
  );
}
