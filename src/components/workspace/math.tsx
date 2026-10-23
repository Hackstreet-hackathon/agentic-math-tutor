"use client";
import katex from "katex";
import { useMemo } from "react";

/** KaTeX render. `trust` stays off, so \href / \url etc. are inert; errors render inline, never throw. */
export function renderLatex(latex: string, displayMode = false): string {
  return katex.renderToString(latex, { throwOnError: false, displayMode, output: "htmlAndMathml", strict: "ignore", maxSize: 50, maxExpand: 500 });
}

export function Latex({ latex, display = false, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => renderLatex(latex, display), [latex, display]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
