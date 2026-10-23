import { Prisma } from "@/generated/prisma/client";
import { ownedPage } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { HttpError, json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { saveObjectsSchema } from "@/lib/notebook/schemas";

/**
 * Batched, idempotent save used by autosave. `upserts` create or update (and undelete);
 * `deletes` soft-delete so work stays recoverable.
 */
export const PUT = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id: pageId } = await params;
  await ownedPage(user.id, pageId);
  const body = await parseJson(req, saveObjectsSchema);

  // An object id may only ever belong to this page (blocks id-collision writes into other users' pages).
  const ids = body.upserts.map((o) => o.id);
  if (ids.length > 0) {
    const clash = await db.pageObject.findFirst({ where: { id: { in: ids }, NOT: { pageId } }, select: { id: true } });
    if (clash) throw new HttpError(409, "Object id already exists on another page", "id_conflict");
  }
  const linkIds = body.upserts.flatMap((o) => (o.linkedToId ? [o.linkedToId] : []));
  const knownLinks = new Set(ids);
  const missingLinks = linkIds.filter((l) => !knownLinks.has(l));
  const existingLinks = missingLinks.length
    ? new Set((await db.pageObject.findMany({ where: { id: { in: missingLinks }, pageId }, select: { id: true } })).map((r) => r.id))
    : new Set<string>();

  await db.$transaction(async (tx) => {
    // Upsert in two passes so intra-batch links never reference a not-yet-created row.
    for (const o of body.upserts) {
      const fields = {
        type: o.type,
        source: o.source,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        rotation: o.rotation,
        zIndex: o.zIndex,
        data: o.data,
        metadata: o.metadata ?? Prisma.DbNull,
        deletedAt: null,
      };
      await tx.pageObject.upsert({ where: { id: o.id }, create: { id: o.id, pageId, ...fields }, update: fields });
    }
    for (const o of body.upserts) {
      const linked = o.linkedToId && (knownLinks.has(o.linkedToId) || existingLinks.has(o.linkedToId)) ? o.linkedToId : null;
      await tx.pageObject.update({ where: { id: o.id }, data: { linkedToId: linked } });
    }
    if (body.deletes.length > 0) {
      await tx.pageObject.updateMany({ where: { id: { in: body.deletes }, pageId }, data: { deletedAt: new Date() } });
    }
    await tx.page.update({ where: { id: pageId }, data: { updatedAt: new Date() } });
  });

  return json({ ok: true, savedAt: new Date().toISOString() });
});
