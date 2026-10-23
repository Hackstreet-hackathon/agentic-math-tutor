import { after } from "next/server";
import { env } from "@/lib/server/env";
import { importPdf, processDocument } from "@/lib/server/documents";
import { HttpError, json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const maxDuration = 120;

/** Import a PDF: multipart form with `file` and optional `notebookId` (append to that notebook). */
export const POST = route(async (req) => {
  const user = await requireUser();
  const limit = env().MAX_PDF_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limit + 64 * 1024) throw new HttpError(413, `PDFs are limited to ${env().MAX_PDF_MB} MB`, "file_too_large");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected a multipart form upload", "invalid_form");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file was uploaded", "missing_file");
  const notebookId = form.get("notebookId");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { notebookId: nbId, document } = await importPdf({
    userId: user.id,
    filename: file.name,
    mimeType: file.type,
    bytes,
    notebookId: typeof notebookId === "string" && notebookId ? notebookId : null,
  });

  after(() => processDocument(document.id));

  return json(
    { notebookId: nbId, document: { id: document.id, originalName: document.originalName, status: document.status, pageCount: document.pageCount } },
    { status: 201 },
  );
});
