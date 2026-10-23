"use client";
import type { GraphExpression, GraphProvider, GraphViewport } from "./types";

/** function-plot provider. Loaded lazily to avoid SSR issues. */
export const functionPlotProvider: GraphProvider = {
  name: "function-plot",

  mount(container, expressions, viewport, onViewportChange) {
    let destroyed = false;
    let cleanupZoom: (() => void) | null = null;

    const render = async () => {
      if (destroyed) return;
      const fp = (await import("function-plot")).default;

      const data = expressions.map((e) => ({
        fn: e.fn,
        color: e.color,
        graphType: "polyline" as const,
      }));

      try {
        const instance = fp({
          target: container,
          width: container.clientWidth || 400,
          height: container.clientHeight || 300,
          xAxis: { domain: [viewport.xMin, viewport.xMax] },
          yAxis: { domain: [viewport.yMin, viewport.yMax] },
          grid: true,
          data,
          disableZoom: false,
        });

        // Propagate viewport changes from zoom/pan back to caller
        // function-plot emits a "zoom" event on its internal EventEmitter
        const notify = () => {
          if (destroyed) return;
          try {
            const meta = instance.meta;
            const x = meta.xScale?.domain() as [number, number] | undefined;
            const y = meta.yScale?.domain() as [number, number] | undefined;
            if (!x || !y) return;
            onViewportChange({ xMin: x[0], xMax: x[1], yMin: y[0], yMax: y[1] });
          } catch {
            // meta not available yet
          }
        };
        instance.on("zoom:scaleUpdate", notify);
        cleanupZoom = () => instance.removeListener("zoom:scaleUpdate", notify);
      } catch {
        // Expression evaluation error — caller shows fallback UI
      }
    };

    void render();

    return () => {
      destroyed = true;
      cleanupZoom?.();
      container.innerHTML = "";
    };
  },

  toSvg(container) {
    const svg = container.querySelector("svg");
    return svg ? new XMLSerializer().serializeToString(svg) : null;
  },
};
