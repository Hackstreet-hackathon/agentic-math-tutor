"use client";
import { useEffect, useRef, useState } from "react";
import { getPdfjs, loadPdfDocument } from "@/lib/client/pdf";

/** Lazily rendered page thumbnail (only starts when scrolled into view). */
export function PdfThumb({ documentId, pageNumber, width }: { documentId: string; pageNumber: number; width: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | undefined;
    (async () => {
      try {
        await getPdfjs();
        const pdf = await loadPdfDocument(documentId);
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: ((width * Math.min(window.devicePixelRatio || 1, 2)) / base.width) });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.render({ canvas, viewport });
        await task.promise;
      } catch {
        /* thumbnail is best-effort */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, documentId, pageNumber, width]);

  return (
    <div ref={hostRef} className="absolute inset-0 bg-white">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
