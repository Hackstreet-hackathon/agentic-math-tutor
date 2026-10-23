import { ownedNotebook } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { buildAnnotatedPdf, type ExportPage } from "@/lib/server/export/pdf";
import { HttpError, route } from "@/lib/server/http";
import { objectFromRow } from "@/lib/server/serialize";
import { requireUser } from "@/lib/server/session";
import { storage } from "@/lib/server/storage";

export const maxDuration = 120;

/** Download the notebook as a PDF: original PDF pages (copied, unmodified) with annotations drawn on top. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const nb = await ownedNotebook(user.id, id);

  const pages = await db.page.findMany({
    where: { notebookId: id },
    orderBy: { position: "asc" },
    include: {
      document: { select: { storageKey: true } },
      objects: { where: { deletedAt: null }, orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] },
    },
  });

  const exportPages: ExportPage[] = pages.map((p) => ({
    pageType: p.pageType,
    width: p.width,
    height: p.height,
    source: p.document && p.pdfPageNumber ? { key: p.document.storageKey, pdfPageNumber: p.pdfPageNumber } : undefined,
    objects: p.objects.map(objectFromRow),
  }));

  let result;
  try {
    result = await buildAnnotatedPdf(nb.title, exportPages, (key) => storage().get(key));
  } catch (e) {
    console.error("export failed:", e instanceof Error ? e.message : "unknown");
    throw new HttpError(500, "Could not build the PDF. The notebook itself is unaffected.", "export_failed");
  }

  const filename = `${nb.title.replace(/[^\p{L}\p{N} _.-]+/gu, "").trim() || "notebook"}-annotated.pdf`;
  return new Response(Buffer.from(result.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(result.bytes.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "X-Export-Skipped": String(result.skipped),
      "Cache-Control": "no-store",
    },
  });
});
