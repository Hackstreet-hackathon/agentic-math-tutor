"use client";
import "pdfjs-dist/web/pdf_viewer.css";
import { useEffect, useRef, useState } from "react";
import { getPdfjs, loadPdfDocument, renderScale } from "@/lib/client/pdf";

/**
 * Layer 1 for PDF pages: the original document rendered by pdf.js (never modified), plus a
 * transparent text layer so text can be selected. Re-renders (debounced) when zoom changes;
 * the previous bitmap stays visible, CSS-scaled, until the sharper one is ready.
 */
export function PdfPageBackground({
  documentId,
  pageNumber,
  width,
  height,
  zoom,
  textSelectable,
}: {
  documentId: string;
  pageNumber: number;
  width: number;
  height: number;
  zoom: number;
  textSelectable: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [renderZoom, setRenderZoom] = useState(zoom);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setRenderZoom(zoom), 180);
    return () => clearTimeout(t);
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let textLayer: { cancel: () => void } | undefined;

    (async () => {
      try {
        const [pdfjs, pdf] = await Promise.all([getPdfjs(), loadPdfDocument(documentId)]);
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const scale = renderScale(renderZoom, width, height);
        const viewport = page.getViewport({ scale });
        const buffer = document.createElement("canvas");
        buffer.width = Math.floor(viewport.width);
        buffer.height = Math.floor(viewport.height);
        renderTask = page.render({ canvas: buffer, viewport });
        await renderTask.promise;
        if (cancelled) return;

        const visible = canvasRef.current;
        if (!visible) return;
        visible.width = buffer.width;
        visible.height = buffer.height;
        visible.getContext("2d")?.drawImage(buffer, 0, 0);
        setState("ready");

        const container = textRef.current;
        if (container) {
          container.replaceChildren();
          const tv = page.getViewport({ scale: renderZoom });
          container.style.setProperty("--scale-factor", String(tv.scale));
          container.style.setProperty("--total-scale-factor", String(tv.scale));
          const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport: tv });
          textLayer = tl;
          await tl.render();
        }
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (!cancelled && name !== "RenderingCancelledException" && name !== "AbortException") setState("error");
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [documentId, pageNumber, renderZoom, width, height, attempt]);

  return (
    <div className="absolute inset-0" data-testid="pdf-background" data-pdf-state={state}>
      <canvas ref={canvasRef} className="absolute left-0 top-0 block" style={{ width: width * zoom, height: height * zoom }} />
      <div
        ref={textRef}
        className="textLayer absolute left-0 top-0"
        style={{ width: width * zoom, height: height * zoom, pointerEvents: textSelectable ? "auto" : "none", userSelect: textSelectable ? "text" : "none" }}
        data-testid="pdf-text-layer"
      />
      {state === "loading" && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Rendering page…</div>}
      {state === "error" && (
        <div role="alert" className="absolute inset-0 grid place-items-center bg-white/80 p-6 text-center text-sm">
          <div>
            <p className="font-medium">Couldn’t render this PDF page</p>
            <p className="mt-1 text-muted">Your annotations are safe. The original file is untouched.</p>
            <button
              className="mt-3 rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-surface"
              onClick={() => {
                setState("loading");
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
