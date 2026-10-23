"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EquationObject, TextObject } from "@/lib/notebook/schemas";
import { Button } from "@/components/ui/button";
import { Latex } from "./math";

/** In-place text editor, positioned over the page object. Commits on blur or Escape. */
export function TextEditor({
  draft,
  zoom,
  onDone,
}: {
  draft: TextObject;
  zoom: number;
  onDone: (text: string, height: number) => void;
}) {
  const [text, setText] = useState(draft.data.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(grow, [text, zoom]);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone(text, Math.max(draft.data.fontSize * 1.35, (ref.current?.scrollHeight ?? 0) / zoom));
  };

  return (
    <textarea
      ref={ref}
      aria-label="Text"
      data-testid="text-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      spellCheck
      rows={1}
      style={{
        position: "absolute",
        left: draft.x * zoom,
        top: draft.y * zoom,
        width: draft.width * zoom,
        fontSize: draft.data.fontSize * zoom,
        color: draft.data.color,
        lineHeight: 1.35,
        fontFamily: "var(--font-sans)",
        padding: 0,
        margin: 0,
        border: "none",
        outline: "1.5px dashed #3b5bdb",
        outlineOffset: 3,
        background: "rgba(255,255,255,0.6)",
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    />
  );
}

const SNIPPETS: { label: string; insert: string; title: string }[] = [
  { label: "a/b", insert: "\\frac{}{}", title: "Fraction" },
  { label: "xⁿ", insert: "^{}", title: "Superscript" },
  { label: "xₙ", insert: "_{}", title: "Subscript" },
  { label: "√", insert: "\\sqrt{}", title: "Square root" },
  { label: "∫", insert: "\\int_{}^{} ", title: "Integral" },
  { label: "∑", insert: "\\sum_{}^{} ", title: "Sum" },
  { label: "π", insert: "\\pi ", title: "Pi" },
  { label: "θ", insert: "\\theta ", title: "Theta" },
  { label: "±", insert: "\\pm ", title: "Plus or minus" },
  { label: "≤", insert: "\\le ", title: "Less or equal" },
  { label: "≥", insert: "\\ge ", title: "Greater or equal" },
  { label: "≠", insert: "\\ne ", title: "Not equal" },
  { label: "∞", insert: "\\infty ", title: "Infinity" },
];

/** Equation editor: live in-place KaTeX preview plus a LaTeX field and symbol shortcuts. */
export function EquationEditor({
  draft,
  zoom,
  pageHeight,
  onDone,
}: {
  draft: EquationObject;
  zoom: number;
  pageHeight: number;
  onDone: (latex: string, size: { width: number; height: number }) => void;
}) {
  const [latex, setLatex] = useState(draft.data.latex);
  const previewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const r = previewRef.current?.getBoundingClientRect();
    onDone(latex.trim(), {
      width: Math.max(20, (r?.width ?? draft.width * zoom) / zoom),
      height: Math.max(draft.data.fontSize, (r?.height ?? draft.height * zoom) / zoom),
    });
  };

  const insert = (snippet: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? latex.length;
    const end = el?.selectionEnd ?? latex.length;
    const next = latex.slice(0, start) + snippet + latex.slice(end);
    const brace = snippet.indexOf("{}");
    const caret = start + (brace >= 0 ? brace + 1 : snippet.length);
    setLatex(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const below = (draft.y + draft.height) * zoom + 12;
  const flip = draft.y + draft.height + 190 > pageHeight;

  return (
    <>
      <div
        ref={previewRef}
        data-testid="equation-preview"
        style={{
          position: "absolute",
          left: draft.x * zoom,
          top: draft.y * zoom,
          width: "max-content",
          fontSize: draft.data.fontSize * zoom,
          color: draft.data.color,
          outline: "1.5px dashed #3b5bdb",
          outlineOffset: 3,
          minWidth: 24 * zoom,
          minHeight: draft.data.fontSize * zoom,
        }}
      >
        {latex.trim() ? <Latex latex={latex} /> : <span style={{ color: "#9a9894", fontSize: 14 }}>Type LaTeX below</span>}
      </div>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Edit equation"
        className="absolute z-20 w-[min(360px,90vw)] rounded-xl border border-line bg-white p-3 shadow-lg"
        style={{ left: Math.max(4, draft.x * zoom), ...(flip ? { bottom: Math.max(4, (pageHeight - draft.y) * zoom + 12) } : { top: below }) }}
        onBlur={(e) => {
          if (!panelRef.current?.contains(e.relatedTarget as Node | null)) finish();
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="LaTeX"
          data-testid="equation-input"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              finish();
            }
          }}
          rows={2}
          spellCheck={false}
          placeholder="e.g. x^2 + 5x + 6 = 0"
          className="w-full resize-none rounded-lg border border-line p-2 font-mono text-sm outline-none focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {SNIPPETS.map((s) => (
            <button
              key={s.title}
              type="button"
              title={s.title}
              aria-label={s.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(s.insert)}
              className="h-7 min-w-8 rounded-md border border-line px-1.5 text-sm hover:bg-surface"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted">Ctrl+Enter to finish</span>
          <Button size="sm" variant="primary" onMouseDown={(e) => e.preventDefault()} onClick={finish}>
            Done
          </Button>
        </div>
      </div>
    </>
  );
}
