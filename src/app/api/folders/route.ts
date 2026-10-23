import { db } from "@/lib/server/db";
import { json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { folderSchema } from "@/lib/notebook/schemas";

export const GET = route(async () => {
  const user = await requireUser();
  const folders = await db.folder.findMany({
    where: { ownerId: user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, _count: { select: { notebooks: true } } },
  });
  return json({ folders: folders.map((f) => ({ id: f.id, name: f.name, color: f.color, notebookCount: f._count.notebooks })) });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, folderSchema);
  const folder = await db.folder.create({ data: { ownerId: user.id, name: body.name, color: body.color ?? null } });
  return json({ folder: { id: folder.id, name: folder.name, color: folder.color, notebookCount: 0 } }, { status: 201 });
});
