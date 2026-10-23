export interface GraphViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface GraphExpression {
  /** JS-evaluable expression in x, e.g. "x^2 - 4" */
  fn: string;
  color: string;
  /** Stable id of the EQUATION page object this trace came from, if any. */
  sourceObjectId: string | null;
}

export type DetectResult =
  | { kind: "ok"; fn: string; label: string }
  | { kind: "ambiguous"; question: string }
  | { kind: "unsupported"; reason: string };

/** Provider abstraction so the underlying graphing engine can be swapped. */
export interface GraphProvider {
  readonly name: string;
  /** Render into container; return a teardown callback. */
  mount(
    container: HTMLElement,
    expressions: GraphExpression[],
    viewport: GraphViewport,
    onViewportChange: (v: GraphViewport) => void,
  ): () => void;
  /** Export the current graph as an SVG string (for PDF export). */
  toSvg(container: HTMLElement): string | null;
}
