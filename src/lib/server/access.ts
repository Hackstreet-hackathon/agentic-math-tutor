import { db } from "./db";
import { notFound } from "./http";

/**
 * Authorization helpers. Every lookup is scoped by owner, and a miss is reported as 404
 * (not 403) so ids of other users' resources cannot be probed.
 */
export async function ownedNotebook(userId: string, notebookId: string) {
  const nb = await db.notebook.findFirst({ where: { id: notebookId, ownerId: userId } });
  if (!nb) throw notFound("Notebook");
  return nb;
}

export async function ownedPage(userId: string, pageId: string) {
  const page = await db.page.findFirst({ where: { id: pageId, notebook: { ownerId: userId } } });
  if (!page) throw notFound("Page");
  return page;
}

export async function ownedFolder(userId: string, folderId: string) {
  const folder = await db.folder.findFirst({ where: { id: folderId, ownerId: userId } });
  if (!folder) throw notFound("Folder");
  return folder;
}

export async function ownedDocument(userId: string, documentId: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, ownerId: userId } });
  if (!doc) throw notFound("Document");
  return doc;
}
