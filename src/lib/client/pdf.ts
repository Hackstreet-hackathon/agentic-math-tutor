"use client";
import type { PDFDocumentProxy } from "pdfjs-dist";

type Pdfjs = typeof import("pdfjs-dist");

let lib: Promise<Pdfjs> | undefined;

/** Worker and static data are copied to /public/pdfjs on postinstall (scripts/copy-pdfjs-assets.mjs). */
const ASSETS = "/pdfjs";

/** pdf.js is loaded on demand (client only). */
export function getPdfjs(): Promise<Pdfjs> {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${ASSETS}/pdf.worker.min.mjs`;
    return m;
  });
  return lib;
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

/** One parsed document per id for the whole session; the file is streamed from the authorised API route. */
export function loadPdfDocument(documentId: string): Promise<PDFDocumentProxy> {
  let p = docs.get(documentId);
  if (!p) {
    p = getPdfjs().then((m) => m.getDocument({
        url: `/api/documents/${documentId}/file`,
        withCredentials: true,
        cMapUrl: `${ASSETS}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}/standard_fonts/`,
        wasmUrl: `${ASSETS}/wasm/`,
        iccUrl: `${ASSETS}/iccs/`,
      }).promise);
    docs.set(documentId, p);
    p.catch(() => docs.delete(documentId)); // allow retry after a failure
  }
  return p;
}

/** Largest backing-store size we are willing to allocate for a page canvas (pixels). */
const MAX_PIXELS = 16_000_000;

export function renderScale(zoom: number, pageWidth: number, pageHeight: number): number {
  const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
  let scale = zoom * dpr;
  const px = pageWidth * scale * pageHeight * scale;
  if (px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
  return scale;
}
