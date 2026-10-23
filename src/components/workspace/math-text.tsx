"use client";
import { Fragment, useMemo } from "react";
import { renderLatex } from "./math";

type Piece = { kind: "text"; text: string } | { kind: "math"; latex: string; display: boolean };

/** Split text on $...$ (inline) and $$...$$ (display). "\$" is a literal dollar sign. */
export function splitMath(src: string): Piece[] {
  const out: Piece[] = [];
  const re = /\\\$|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += t;
    else out.push({ kind: "text", text: t });
  };
  while ((m = re.exec(src))) {
    pushText(src.slice(last, m.index));
    if (m[0] === "\\$") pushText("$");
    else if (m[1] !== undefined) out.push({ kind: "math", latex: m[1].trim(), display: true });
    else out.push({ kind: "math", latex: (m[2] ?? "").trim(), display: false });
    last = m.index + m[0].length;
  }
  pushText(src.slice(last));
  return out;
}

/** Very small, safe formatter: **bold**, `code`, line breaks. No raw HTML is ever interpreted. */
function formatPlain(text: string, keyBase: string) {
  return text.split("\n").map((line, li, lines) => (
    <Fragment key={`${keyBase}-${li}`}>
      {line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, i) =>
        seg.startsWith("**") && seg.endsWith("**") && seg.length > 4 ? (
          <strong key={i}>{seg.slice(2, -2)}</strong>
        ) : seg.startsWith("`") && seg.endsWith("`") && seg.length > 2 ? (
          <code key={i} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">
            {seg.slice(1, -1)}
          </code>
        ) : (
          seg
        ),
      )}
      {li < lines.length - 1 && <br />}
    </Fragment>
  ));
}

/** Text with rendered mathematics. Raw LaTeX is never shown as the default view. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const pieces = useMemo(() => splitMath(text), [text]);
  return (
    <span className={className}>
      {pieces.map((p, i) =>
        p.kind === "text" ? (
          <Fragment key={i}>{formatPlain(p.text, String(i))}</Fragment>
        ) : (
          <span key={i} className={p.display ? "block overflow-x-auto py-1" : undefined} dangerouslySetInnerHTML={{ __html: renderLatex(p.latex, p.display) }} />
        ),
      )}
    </span>
  );
}
