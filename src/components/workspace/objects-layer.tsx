"use client";
import { memo, useLayoutEffect, useRef } from "react";
import type { NotebookObject } from "@/lib/notebook/schemas";
import { Latex } from "./math";
import { MathText } from "./math-text";

const VERIFY_LABEL: Record<string, { text: string; tone: string }> = {
  VERIFIED: { text: "Verified ✓", tone: "text-green-700" },
  INCORRECT: { text: "Check failed", tone: "text-red-700" },
  UNCERTAIN: { text: "Uncertain", tone: "text-amber-700" },
  PENDING: { text: "Not verified", tone: "text-muted" },
  UNSUPPORTED: { text: "Not verified", tone: "text-muted" },
};

/** AI-written solution card: deliberately distinct from the student's own ink and text. */
function SolutionCard({ o, onMeasure }: { o: Extract<NotebookObject, { type: "AI_SOLUTION" }>; onMeasure?: (id: string, height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight;
    if (h && Math.abs(h - o.height) > 2) onMeasure?.(o.id, h);
  });
  const v = VERIFY_LABEL[o.data.verificationStatus] ?? VERIFY_LABEL.PENDING!;
  return (
    <div
      ref={ref}
      data-testid="ai-solution"
      style={{ position: "absolute", left: o.x, top: o.y, width: o.width }}
      className="rounded-lg border-l-4 border-accent bg-[#eef1ff]/80 px-3 py-2 text-[13px] leading-snug text-ink shadow-sm"
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-accent">
        <span>AI solution</span>
        <span className={`rounded bg-white/80 px-1.5 py-0.5 normal-case tracking-normal ${v.tone}`}>{v.text}</span>
      </div>
      {o.data.title && o.data.title !== "Solution" && <div className="mb-1 font-medium"><MathText text={o.data.title} /></div>}
      <ol className="space-y-1.5">
        {o.data.steps.map((s, i) => (
          <li key={i}>
            {s.latex && <div className="overflow-x-auto text-[17px]"><Latex latex={s.latex} /></div>}
            {s.explanation && <div className="text-muted"><MathText text={s.explanation} /></div>}
          </li>
        ))}
      </ol>
      {o.data.finalAnswer && (
        <div className="mt-2 rounded-md bg-white/80 px-2 py-1.5">
          <span className="mr-2 text-[11px] font-medium uppercase tracking-wide text-muted">Answer</span>
          <span className="text-[17px]"><Latex latex={o.data.finalAnswer} /></span>
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

const Item = memo(function Item({ o, onMeasure }: { o: NotebookObject; onMeasure?: (id: string, height: number) => void }) {
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

/** Editable text and mathematical objects, rendered as real DOM so text stays crisp and selectable. */
export function ObjectsLayer({ objects, zoom, width, height, onMeasure }: { objects: NotebookObject[]; zoom: number; width: number; height: number; onMeasure?: (id: string, height: number) => void }) {
  return (
    <div
      aria-hidden={false}
      style={{ position: "absolute", left: 0, top: 0, width, height, transform: `scale(${zoom})`, transformOrigin: "0 0", pointerEvents: "none" }}
    >
      {objects.map((o) => (o.type === "TEXT" || o.type === "EQUATION" || o.type === "AI_SOLUTION" ? <Item key={o.id} o={o} onMeasure={onMeasure} /> : null))}
    </div>
  );
}
