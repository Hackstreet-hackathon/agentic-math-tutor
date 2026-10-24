"use client";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { EquationObject, GraphObject, NotebookObject } from "@/lib/notebook/schemas";
import { GraphCard } from "./graph-panel";
import { Latex } from "./math";
import { MathText } from "./math-text";

const VERIFY_LABEL: Record<string, { text: string; tone: string }> = {
  VERIFIED: { text: "Verified ✓", tone: "text-green-700" },
  INCORRECT: { text: "Check failed", tone: "text-red-700" },
  UNCERTAIN: { text: "Uncertain", tone: "text-amber-700" },
  PENDING: { text: "Not verified", tone: "text-muted" },
  UNSUPPORTED: { text: "Not verified", tone: "text-muted" },
};

/** Solutions inserted in this session that should be "written" once; cleared after the animation so remounts show them instantly. */
const freshSolutions = new Set<string>();
export function markFreshSolution(id: string, ms: number) {
  freshSolutions.add(id);
  setTimeout(() => freshSolutions.delete(id), ms + 500);
}

const msFor = (text: string) => Math.min(2200, 450 + text.length * 35);
const PAUSE_MS = 250;

/** AI-written solution: handwriting-styled, written step by step, and it stays on the page. */
function SolutionCard({
  o,
  onMeasure,
}: {
  o: Extract<NotebookObject, { type: "AI_SOLUTION" }>;
  onMeasure?: (id: string, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight;
    if (h && Math.abs(h - o.height) > 2) onMeasure?.(o.id, h);
  });
  const v = VERIFY_LABEL[o.data.verificationStatus] ?? VERIFY_LABEL.PENDING!;
  const ink = o.data.verificationStatus === "VERIFIED" ? "#15803d" : "#1e40af";
  const fresh = freshSolutions.has(o.id);

  // Each line starts when the previous one has finished being written.
  const lines = [
    ...o.data.steps.flatMap((s) => [s.latex, s.explanation]),
    o.data.finalAnswer ?? "",
  ].filter(Boolean);
  const delays = new Map<string, string>();
  lines.reduce((acc, text) => {
    delays.set(text, `${acc}`);
    return acc + msFor(text) + PAUSE_MS;
  }, 0);
  const line = (text: string): React.CSSProperties | undefined =>
    fresh ? ({ "--write-delay": `${delays.get(text) ?? 0}ms`, "--write-ms": `${msFor(text)}ms` } as React.CSSProperties) : undefined;
  const cls = fresh ? "ink-write" : undefined;

  return (
    <div
      ref={ref}
      data-testid="ai-solution"
      style={{ position: "absolute", left: o.x, top: o.y, width: o.width, color: ink }}
      className="handwritten relative rounded-lg border-l-4 border-accent bg-[#eef1ff]/60 px-3 py-2 text-[19px] leading-snug shadow-sm"
    >
      <div className="mb-1 flex items-center gap-2 font-sans text-[11px] font-medium uppercase tracking-wide text-accent">
        <span>AI solution</span>
        <span className={`rounded bg-white/80 px-1.5 py-0.5 normal-case tracking-normal ${v.tone}`}>{v.text}</span>
      </div>
      <ol className="space-y-1.5">
        {o.data.steps.map((s, i) => (
          <li key={i}>
            {s.latex && <div className={`overflow-x-auto text-[24px] ${cls ?? ""}`} style={line(s.latex)}><Latex latex={s.latex} /></div>}
            {s.explanation && <div className={`opacity-80 ${cls ?? ""}`} style={line(s.explanation)}><MathText text={s.explanation} /></div>}
          </li>
        ))}
      </ol>
      {o.data.finalAnswer && (
        <div className={`mt-2 border-t border-current/30 pt-1.5 text-[26px] ${cls ?? ""}`} style={line(o.data.finalAnswer)}>
          <span className="mr-2 text-[18px] opacity-70">Answer:</span>
          <Latex latex={o.data.finalAnswer} />
        </div>
      )}
    </div>
  );
}

const FONT: Record<string, string> = {
  sans: "var(--font-sans)",
  serif: "Georgia, 'Times New Roman', serif",
  hand: "var(--font-hand)",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const Item = memo(function Item({
  o,
  onMeasure,
}: {
  o: NotebookObject;
  onMeasure?: (id: string, height: number) => void;
}) {
  const pos = { position: "absolute", left: o.x, top: o.y, width: o.width } as const;
  switch (o.type) {
    case "TEXT":
      return (
        <div
          style={{
            ...pos,
            fontSize: o.data.fontSize,
            color: o.data.color,
            fontFamily: FONT[o.data.fontFamily],
            lineHeight: 1.35,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {o.data.text}
        </div>
      );
    case "EQUATION":
      return (
        <div style={{ ...pos, width: "max-content", fontSize: o.data.fontSize, color: o.data.color }}>
          <Latex latex={o.data.latex} />
        </div>
      );
    case "AI_SOLUTION":
      return <SolutionCard o={o} onMeasure={onMeasure} />;
    default:
      return null;
  }
});

// GraphItem is handled separately (needs equationMap) — see ObjectsLayer.

/** Editable text and mathematical objects, rendered as real DOM so text stays crisp and selectable. */
export function ObjectsLayer({ objects, zoom, width, height, onMeasure }: { objects: NotebookObject[]; zoom: number; width: number; height: number; onMeasure?: (id: string, height: number) => void }) {
  const equationMap = useMemo(() => {
    const m = new Map<string, EquationObject>();
    for (const o of objects) if (o.type === "EQUATION") m.set(o.id, o);
    return m;
  }, [objects]);

  return (
    <div
      aria-hidden={false}
      style={{ position: "absolute", left: 0, top: 0, width, height, transform: `scale(${zoom})`, transformOrigin: "0 0", pointerEvents: "none" }}
    >
      {objects.map((o) => {
        if (o.type === "TEXT" || o.type === "EQUATION" || o.type === "AI_SOLUTION") {
          return <Item key={o.id} o={o} onMeasure={onMeasure} />;
        }
        if (o.type === "GRAPH") return <GraphCard key={o.id} o={o as GraphObject} equationMap={equationMap} />;
        return null;
      })}
    </div>
  );
}
