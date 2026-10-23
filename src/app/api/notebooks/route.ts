import { ownedFolder } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { createNotebookSchema } from "@/lib/notebook/schemas";
import { DEFAULT_PAGE } from "@/lib/notebook/geometry";

export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const folderId = url.searchParams.get("folderId");

  const notebooks = await db.notebook.findMany({
    where: {
      ownerId: user.id,
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
      ...(folderId ? { folderId } : {}),
    },
    orderBy: { lastOpenedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      folderId: true,
      lastOpenedAt: true,
      updatedAt: true,
      defaultPageType: true,
      _count: { select: { pages: true } },
      documents: { select: { id: true, originalName: true, status: true, statusMessage: true, pageCount: true } },
    },
  });
  return json({ notebooks });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, createNotebookSchema);
  if (body.folderId) await ownedFolder(user.id, body.folderId);

  const notebook = await db.notebook.create({
    data: {
      ownerId: user.id,
      title: body.title,
      folderId: body.folderId ?? null,
      defaultPageType: body.pageType,
      pages: { create: { position: 0, pageType: body.pageType, ...DEFAULT_PAGE } },
    },
    select: { id: true, title: true },
  });
  return json({ notebook }, { status: 201 });
});
