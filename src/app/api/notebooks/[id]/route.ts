import { ownedFolder, ownedNotebook } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { deleteDocumentFiles } from "@/lib/server/documents";
import { json, notFound, parseJson, route } from "@/lib/server/http";
import { objectFromRow } from "@/lib/server/serialize";
import { requireUser } from "@/lib/server/session";
import { updateNotebookSchema } from "@/lib/notebook/schemas";

/** Full notebook payload for the workspace: pages with their (non-deleted) objects. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const nb = await db.notebook.findFirst({
    where: { id, ownerId: user.id },
    include: {
      pages: {
        orderBy: { position: "asc" },
        include: { objects: { where: { deletedAt: null }, orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] } },
      },
      documents: { select: { id: true, originalName: true, status: true, statusMessage: true, pageCount: true, metadata: true } },
    },
  });
  if (!nb) throw notFound("Notebook");
  await db.notebook.update({ where: { id }, data: { lastOpenedAt: new Date() }, select: { id: true } });

  return json({
    notebook: {
      id: nb.id,
      title: nb.title,
      folderId: nb.folderId,
      defaultPageType: nb.defaultPageType,
      documents: nb.documents.map(({ metadata, ...d }) => ({
        ...d,
        scannedPages: ((metadata as { scannedPages?: number[] } | null)?.scannedPages ?? []) as number[],
      })),
      pages: nb.pages.map((p) => ({
        id: p.id,
        position: p.position,
        pageType: p.pageType,
        width: p.width,
        height: p.height,
        documentId: p.documentId,
        pdfPageNumber: p.pdfPageNumber,
        objects: p.objects.map(objectFromRow),
      })),
    },
  });
});

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  await ownedNotebook(user.id, id);
  const body = await parseJson(req, updateNotebookSchema);
  if (body.folderId) await ownedFolder(user.id, body.folderId);
  const notebook = await db.notebook.update({
    where: { id },
    data: body,
    select: { id: true, title: true, folderId: true, defaultPageType: true },
  });
  return json({ notebook });
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  await ownedNotebook(user.id, id);
  const docs = await db.document.findMany({ where: { notebookId: id }, select: { storageKey: true } });
  await db.notebook.delete({ where: { id } });
  await deleteDocumentFiles(docs.map((d) => d.storageKey));
  return json({ ok: true });
});
