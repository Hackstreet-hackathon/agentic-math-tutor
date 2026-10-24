// Promise.withResolvers is Node 22+; polyfill for Node 20 where pdfjs-dist requires it.
if (typeof Promise.withResolvers === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

/**
 * PDF inspection and text extraction (server side, pdf.js legacy build for Node).
 *
 * Everything here treats the PDF as untrusted input: font loading is disabled (pdf.js v6 no longer evaluates code),
 * work is time-limited, and extracted text is size-capped. Extraction is the seam where a
 * background worker or OCR provider can be plugged in later.
 */
export class PdfError extends Error {
  constructor(
    public kind: "invalid" | "encrypted" | "too_many_pages" | "timeout" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

export const MAX_PDF_PAGES = 500;
const MAX_CHARS_PER_PAGE = 60_000;
const OP_TIMEOUT_MS = 45_000;

export interface PdfInfo {
  pageCount: number;
  pages: { width: number; height: number }[];
  metadata: { title?: string; author?: string; producer?: string };
}

export interface PageText {
  pageNumber: number;
  text: string;
  /** Text items with boxes normalised to 0..1 of the page (top-left origin). */
  items: { t: string; x: number; y: number; w: number; h: number }[];
  source: "pdf-text" | "none";
}

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfjsModule> | undefined;
const load = () => (pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

async function withTimeout<T>(p: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfError("timeout", "PDF processing timed out")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function open(bytes: Uint8Array) {
  const lib = await load();
  // pdf.js transfers/detaches the buffer, so always hand it a copy.
  const task = lib.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await withTimeout(task.promise);
    return { lib, doc, close: () => void task.destroy() };
  } catch (e) {
    void task.destroy();
    throw classify(e);
  }
}

function classify(e: unknown): PdfError {
  if (e instanceof PdfError) return e;
  const name = (e as { name?: string })?.name;
  if (name === "PasswordException") return new PdfError("encrypted", "Password-protected PDFs are not supported");
  if (name === "InvalidPDFException" || name === "FormatError" || name === "MissingPDFException") {
    return new PdfError("invalid", "This file is not a valid or complete PDF");
  }
  return new PdfError("unknown", "Could not read this PDF");
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const { doc, close } = await open(bytes);
  try {
    if (doc.numPages < 1) throw new PdfError("invalid", "The PDF has no pages");
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfError("too_many_pages", `PDFs are limited to ${MAX_PDF_PAGES} pages`);
    const pages: PdfInfo["pages"] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await withTimeout(doc.getPage(i));
      const vp = page.getViewport({ scale: 1 });
      pages.push({ width: round(vp.width), height: round(vp.height) });
    }
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    return {
      pageCount: doc.numPages,
      pages,
      metadata: { title: str(info.Title), author: str(info.Author), producer: str(info.Producer) },
    };
  } catch (e) {
    throw classify(e);
  } finally {
    close();
  }
}

/** Extract per-page text + normalised item boxes. Pages without a text layer are flagged `none`. */
export async function extractText(bytes: Uint8Array): Promise<PageText[]> {
  const { lib, doc, close } = await open(bytes);
  try {
    const out: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await withTimeout(doc.getPage(i));
      const vp = page.getViewport({ scale: 1 });
      const content = await withTimeout(page.getTextContent());
      const items: PageText["items"] = [];
      let text = "";
      for (const it of content.items) {
        if (!("str" in it)) continue;
        if (it.str.length > 0) {
          const tx = lib.Util.transform(vp.transform, it.transform);
          const fontH = Math.hypot(tx[2]!, tx[3]!);
          items.push({
            t: it.str,
            x: round((tx[4]! / vp.width), 4),
            y: round(((tx[5]! - fontH) / vp.height), 4),
            w: round((it.width * vp.scale) / vp.width, 4),
            h: round(fontH / vp.height, 4),
          });
        }
        if (text.length < MAX_CHARS_PER_PAGE) text += it.str + (it.hasEOL ? "\n" : "");
      }
      const trimmed = text.trim().slice(0, MAX_CHARS_PER_PAGE);
      const hasText = trimmed.replace(/\s/g, "").length >= 3;
      out.push({ pageNumber: i, text: hasText ? trimmed : "", items: hasText ? items.slice(0, 5000) : [], source: hasText ? "pdf-text" : "none" });
    }
    return out;
  } catch (e) {
    throw classify(e);
  } finally {
    close();
  }
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Cheap structural check before handing bytes to the parser. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}
