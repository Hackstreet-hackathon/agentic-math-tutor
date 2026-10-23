"use client";
import { BarChart2, BarChart3, Maximize2, Minimize2, Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectGraphable } from "@/lib/graph/detect";
import type { GraphExpression, GraphViewport } from "@/lib/graph/types";
import type { EquationObject, GraphObject } from "@/lib/notebook/schemas";
import type { PageDto } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Latex } from "./math";

const DEFAULT_VIEWPORT: GraphViewport = { xMin: -10, xMax: 10, yMin: -8, yMax: 8 };
const GRAPH_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899"];

type TraceState =
  | { kind: "ok"; fn: string; label: string; enabled: boolean }
  | { kind: "ambiguous"; question: string; confirmed: boolean | null }
  | { kind: "unsupported"; reason: string };

interface EquationTrace {
  objectId: string;
  latex: string;
  state: TraceState;
}

/** Interactive graph panel showing detected functions from the current page. */
export function GraphPanel({
  page,
  onClose,
  onInsertGraph,
}: {
  page: PageDto;
  onClose: () => void;
  onInsertGraph: (expressions: GraphObject["data"]["expressions"], viewport: GraphObject["data"]["viewport"]) => void;
}) {
  const equations = useMemo(
    () => page.objects.filter((o): o is EquationObject => o.type === "EQUATION"),
    [page.objects],
  );

  const [traces, setTraces] = useState<EquationTrace[]>(() =>
    equations.map((eq) => ({
      objectId: eq.id,
      latex: eq.data.latex,
      state: toTrace(detectGraphable(eq.data.latex)),
    })),
  );
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_VIEWPORT);
  const containerRef = useRef<HTMLDivElement>(null);
  const destroyRef = useRef<(() => void) | null>(null);

  // Re-sync traces when equations change (equations added/edited on page)
  useEffect(() => {
    setTraces((prev) => {
      const prevMap = new Map(prev.map((t) => [t.objectId, t]));
      return equations.map((eq) => {
        const existing = prevMap.get(eq.id);
        // If latex changed, re-detect
        if (existing && existing.latex === eq.data.latex) return existing;
        return { objectId: eq.id, latex: eq.data.latex, state: toTrace(detectGraphable(eq.data.latex)) };
      });
    });
  }, [equations]);

  const activeExpressions = useMemo<GraphExpression[]>(() => {
    return traces.flatMap((t, i) => {
      if (t.state.kind !== "ok" || !t.state.enabled) return [];
      return [{ fn: t.state.fn, color: GRAPH_COLORS[i % GRAPH_COLORS.length]!, sourceObjectId: t.objectId }];
    });
  }, [traces]);

  // Re-render graph when expressions or viewport changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    destroyRef.current?.();
    if (activeExpressions.length === 0) {
      destroyRef.current = null;
      return;
    }
    let cancelled = false;
    import("@/lib/graph/function-plot-provider").then(({ functionPlotProvider }) => {
      if (cancelled || !containerRef.current) return;
      destroyRef.current = functionPlotProvider.mount(containerRef.current, activeExpressions, viewport, (v) => {
        if (!cancelled) setViewport(v);
      });
    });
    return () => {
      cancelled = true;
      destroyRef.current?.();
      destroyRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExpressions]);

  const toggle = useCallback((id: string) => {
    setTraces((prev) => prev.map((t) => t.objectId === id && t.state.kind === "ok" ? { ...t, state: { ...t.state, enabled: !t.state.enabled } } : t));
  }, []);

  const confirmAmbiguous = useCallback((id: string, yes: boolean) => {
    setTraces((prev) =>
      prev.map((t) => {
        if (t.objectId !== id || t.state.kind !== "ambiguous") return t;
        if (!yes) return { ...t, state: { kind: "unsupported", reason: "Skipped." } };
        // Try parsing the latex directly as y=f(x)
        const d = detectGraphable(`y = ${t.latex}`);
        return { ...t, state: d.kind === "ok" ? { ...d, enabled: true } : { kind: "unsupported", reason: d.kind === "ambiguous" ? d.question : d.reason } };
      }),
    );
  }, []);

  const reset = () => setViewport(DEFAULT_VIEWPORT);

  const insert = () => {
    const exprs = traces.flatMap<GraphObject["data"]["expressions"][number]>((t, i) => {
      if (t.state.kind !== "ok" || !t.state.enabled) return [];
      return [{ id: t.objectId, latex: t.latex, color: GRAPH_COLORS[i % GRAPH_COLORS.length]!, sourceObjectId: t.objectId }];
    });
    if (exprs.length === 0) return;
    onInsertGraph(exprs, { xmin: viewport.xMin, xmax: viewport.xMax, ymin: viewport.yMin, ymax: viewport.yMax });
  };

  return (
    <aside
      aria-label="Graph"
      data-testid="graph-panel"
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-line bg-white shadow-xl md:static md:z-auto md:w-[400px] md:max-w-none md:shrink-0 md:shadow-none"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <BarChart3 size={16} className="text-accent" />
        <p className="flex-1 text-sm font-semibold">Graph</p>
        <button aria-label="Close graph" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5">
          <X size={16} />
        </button>
      </header>

      {/* Equation list */}
      <div className="shrink-0 space-y-1 overflow-y-auto border-b border-line px-3 py-2" style={{ maxHeight: "40%" }}>
        {equations.length === 0 && (
          <p className="py-3 text-sm text-muted">No equations on this page. Add an equation with the <strong>M</strong> tool.</p>
        )}
        {traces.map((t, i) => {
          const color = GRAPH_COLORS[i % GRAPH_COLORS.length]!;
          return (
            <div key={t.objectId} className="flex items-start gap-2 rounded-lg py-1">
              {t.state.kind === "ok" && (
                <button
                  aria-pressed={t.state.enabled}
                  title={t.state.enabled ? "Hide from graph" : "Show on graph"}
                  onClick={() => toggle(t.objectId)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-2 transition-colors"
                  style={{ borderColor: color, backgroundColor: t.state.enabled ? color : "transparent" }}
                />
              )}
              {t.state.kind !== "ok" && <span className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-2 border-line bg-surface" />}
              <div className="min-w-0 flex-1">
                <div className="overflow-x-auto text-sm"><Latex latex={t.latex} /></div>
                {t.state.kind === "unsupported" && (
                  <p className="mt-0.5 text-[11px] text-muted">{t.state.reason}</p>
                )}
                {t.state.kind === "ambiguous" && t.state.confirmed === null && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <p className="text-[11px] text-muted">{t.state.question}</p>
                    <button onClick={() => confirmAmbiguous(t.objectId, true)} className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-white">Yes</button>
                    <button onClick={() => confirmAmbiguous(t.objectId, false)} className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink border border-line">Skip</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Graph area */}
      <div className="relative min-h-0 flex-1">
        {activeExpressions.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted text-center">
            <div>
              <BarChart2 size={40} className="mx-auto mb-3 opacity-20" />
              <p>Enable at least one graphable equation above.</p>
            </div>
          </div>
        ) : (
          <div ref={containerRef} className="h-full w-full" data-testid="graph-container" />
        )}
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          <button onClick={reset} title="Reset zoom" className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-white/90 shadow-sm hover:bg-surface">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-line p-3">
        <button
          onClick={insert}
          disabled={activeExpressions.length === 0}
          data-testid="insert-graph"
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium",
            activeExpressions.length > 0 ? "bg-accent text-white hover:bg-accent/90" : "bg-surface text-muted cursor-not-allowed",
          )}
        >
          <Plus size={14} /> Write graph onto page
        </button>
      </footer>
    </aside>
  );
}

/** Graph card rendered as a page object. */
export function GraphCard({
  o,
  equationMap,
}: {
  o: GraphObject;
  equationMap: Map<string, EquationObject>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const destroyRef = useRef<(() => void) | null>(null);
  const [vp, setVp] = useState<GraphViewport>({
    xMin: o.data.viewport.xmin,
    xMax: o.data.viewport.xmax,
    yMin: o.data.viewport.ymin,
    yMax: o.data.viewport.ymax,
  });

  // Live-update expressions: if source equation changed, re-detect
  const expressions = useMemo<GraphExpression[]>(() =>
    o.data.expressions.flatMap((e) => {
      const eq = e.sourceObjectId ? equationMap.get(e.sourceObjectId) : null;
      const latex = eq ? eq.data.latex : e.latex;
      const d = detectGraphable(latex);
      if (d.kind !== "ok") return [];
      return [{ fn: d.fn, color: e.color, sourceObjectId: e.sourceObjectId ?? null }];
    }), [o.data.expressions, equationMap]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    destroyRef.current?.();
    if (expressions.length === 0) { destroyRef.current = null; return; }
    let cancelled = false;
    import("@/lib/graph/function-plot-provider").then(({ functionPlotProvider }) => {
      if (cancelled || !containerRef.current) return;
      destroyRef.current = functionPlotProvider.mount(containerRef.current, expressions, vp, (v) => {
        if (!cancelled) setVp(v);
      });
    });
    return () => { cancelled = true; destroyRef.current?.(); destroyRef.current = null; };
  // Re-mount when expressions change (source equation edited)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expressions]);

  return (
    <div
      style={{ position: "absolute", left: o.x, top: o.y, width: o.width, height: o.height }}
      className="overflow-hidden rounded-lg border border-line bg-white shadow-sm"
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

// ---- helpers ----

function toTrace(d: ReturnType<typeof detectGraphable>): TraceState {
  if (d.kind === "ok") return { ...d, enabled: true };
  if (d.kind === "ambiguous") return { ...d, confirmed: null };
  return d;
}
