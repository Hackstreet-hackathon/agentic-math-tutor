import { ownedPage } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { HttpError, json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { updatePageSchema } from "@/lib/notebook/schemas";

/** Change page background and/or reorder. Returns the notebook's new page order. */
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const page = await ownedPage(user.id, id);
  const body = await parseJson(req, updatePageSchema);

  if (body.pageType && page.pageType === "PDF") {
    throw new HttpError(400, "PDF pages keep the document as their background", "invalid_page_type");
  }

  const order = await db.$transaction(async (tx) => {
    if (body.pageType) await tx.page.update({ where: { id }, data: { pageType: body.pageType } });
    if (body.position !== undefined && body.position !== page.position) {
      const siblings = await tx.page.findMany({
        where: { notebookId: page.notebookId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const ids = siblings.map((s) => s.id).filter((x) => x !== id);
      ids.splice(Math.min(body.position, ids.length), 0, id);
      await Promise.all(ids.map((pid, i) => tx.page.update({ where: { id: pid }, data: { position: i } })));
    }
    return tx.page.findMany({
      where: { notebookId: page.notebookId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, pageType: true },
    });
  });
  return json({ pages: order });
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const page = await ownedPage(user.id, id);

  const remaining = await db.$transaction(async (tx) => {
    const count = await tx.page.count({ where: { notebookId: page.notebookId } });
    if (count <= 1) throw new HttpError(400, "A notebook needs at least one page", "last_page");
    await tx.page.delete({ where: { id } });
    await tx.page.updateMany({
      where: { notebookId: page.notebookId, position: { gt: page.position } },
      data: { position: { decrement: 1 } },
    });
    return tx.page.findMany({
      where: { notebookId: page.notebookId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
  });
  return json({ pages: remaining });
});
