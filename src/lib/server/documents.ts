import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { extractText, inspectPdf, looksLikePdf, PdfError } from "./pdf/analyze";
import { storage } from "./storage";
import { ownedNotebook } from "./access";

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document.pdf";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim().slice(0, 200);
  return cleaned || "document.pdf";
}

const titleFromFilename = (name: string) => name.replace(/\.pdf$/i, "").trim().slice(0, 120) || "Imported PDF";

function pdfErrorToHttp(e: PdfError): HttpError {
  const status = e.kind === "too_many_pages" ? 413 : 422;
  return new HttpError(status, e.message, `pdf_${e.kind}`);
}

/**
 * Validate, store and register an uploaded PDF, creating one notebook page per PDF page
 * so the student can start annotating immediately. Text extraction runs afterwards
 * (`processDocument`) and does not block opening the notebook.
 */
export async function importPdf(opts: { userId: string; filename: string; mimeType: string; bytes: Uint8Array; notebookId?: string | null }) {
  const { userId, bytes } = opts;
  const maxBytes = env().MAX_PDF_MB * 1024 * 1024;
  if (bytes.byteLength === 0) throw new HttpError(400, "The file is empty", "empty_file");
  if (bytes.byteLength > maxBytes) throw new HttpError(413, `PDFs are limited to ${env().MAX_PDF_MB} MB`, "file_too_large");
  const mimeOk = opts.mimeType === "application/pdf" || opts.mimeType === "application/x-pdf" || opts.mimeType === "";
  if (!mimeOk || !looksLikePdf(bytes)) throw new HttpError(415, "Only PDF files can be imported", "unsupported_type");

  let info;
  try {
    info = await inspectPdf(bytes);
  } catch (e) {
    if (e instanceof PdfError) throw pdfErrorToHttp(e);
    throw e;
  }

  const notebook = opts.notebookId ? await ownedNotebook(userId, opts.notebookId) : null;
  const filename = sanitizeFilename(opts.filename);
  const docId = randomUUID();
  const storageKey = `users/${userId}/documents/${docId}.pdf`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await storage().put(storageKey, bytes, "application/pdf");

  try {
    return await db.$transaction(async (tx) => {
      const nb =
        notebook ??
        (await tx.notebook.create({ data: { ownerId: userId, title: titleFromFilename(filename), defaultPageType: "RULED" } }));
      const document = await tx.document.create({
        data: {
          id: docId,
          ownerId: userId,
          notebookId: nb.id,
          originalName: filename,
          storageKey,
          mimeType: "application/pdf",
          sizeBytes: bytes.byteLength,
          sha256,
          pageCount: info.pageCount,
          status: "PROCESSING",
          metadata: { ...info.metadata },
        },
      });
      const start = notebook ? await tx.page.count({ where: { notebookId: nb.id } }) : 0;
      await tx.page.createMany({
        data: info.pages.map((p, i) => ({
          notebookId: nb.id,
          position: start + i,
          pageType: "PDF" as const,
          width: p.width,
          height: p.height,
          documentId: document.id,
          pdfPageNumber: i + 1,
        })),
      });
      return { notebookId: nb.id, document };
    });
  } catch (e) {
    await storage().delete(storageKey).catch(() => undefined);
    throw e;
  }
}

/** Extract and cache per-page text. Failure leaves the PDF fully usable for annotation. */
export async function processDocument(documentId: string): Promise<void> {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return;
  try {
    const bytes = await storage().get(doc.storageKey);
    const pages = await extractText(bytes);
    const scanned = pages.filter((p) => p.source === "none").map((p) => p.pageNumber);
    await db.$transaction([
      db.documentPageText.deleteMany({ where: { documentId } }),
      db.documentPageText.createMany({
        data: pages.map((p) => ({ documentId, pageNumber: p.pageNumber, text: p.text, items: p.items, source: p.source })),
      }),
      db.document.update({
        where: { id: documentId },
        data: {
          status: "READY",
          statusMessage: null,
          metadata: {
            ...(typeof doc.metadata === "object" && doc.metadata && !Array.isArray(doc.metadata) ? doc.metadata : {}),
            hasTextLayer: scanned.length < pages.length,
            scannedPages: scanned,
            textChars: pages.reduce((n, p) => n + p.text.length, 0),
          },
        },
      }),
    ]);
  } catch (e) {
    const message = e instanceof PdfError ? e.message : "Text extraction failed";
    console.error("processDocument failed:", documentId, e instanceof Error ? e.name : "unknown");
    await db.document.update({ where: { id: documentId }, data: { status: "FAILED", statusMessage: message } }).catch(() => undefined);
  }
}

export async function deleteDocumentFiles(storageKeys: string[]): Promise<void> {
  await Promise.all(storageKeys.map((k) => storage().delete(k).catch(() => console.error("Failed to delete stored file"))));
}
