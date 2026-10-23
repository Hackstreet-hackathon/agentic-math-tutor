import { ownedFolder } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { folderSchema } from "@/lib/notebook/schemas";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  await ownedFolder(user.id, id);
  const body = await parseJson(req, folderSchema.partial());
  const folder = await db.folder.update({ where: { id }, data: body });
  return json({ folder: { id: folder.id, name: folder.name, color: folder.color } });
});

/** Deleting a folder keeps its notebooks (they return to "All notebooks"). */
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  await ownedFolder(user.id, id);
  await db.folder.delete({ where: { id } });
  return json({ ok: true });
});
