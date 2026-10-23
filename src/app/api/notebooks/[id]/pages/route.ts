import { ownedNotebook } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { createPageSchema } from "@/lib/notebook/schemas";
import { DEFAULT_PAGE } from "@/lib/notebook/geometry";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const nb = await ownedNotebook(user.id, id);
  const body = await parseJson(req, createPageSchema);

  const page = await db.$transaction(async (tx) => {
    const count = await tx.page.count({ where: { notebookId: id } });
    const insertAt = body.afterPosition === undefined ? count : Math.min(body.afterPosition + 1, count);
    // Shift later pages down to make room.
    await tx.page.updateMany({ where: { notebookId: id, position: { gte: insertAt } }, data: { position: { increment: 1 } } });
    return tx.page.create({
      data: { notebookId: id, position: insertAt, pageType: body.pageType ?? nb.defaultPageType, ...DEFAULT_PAGE },
    });
  });

  return json(
    {
      page: {
        id: page.id,
        position: page.position,
        pageType: page.pageType,
        width: page.width,
        height: page.height,
        documentId: null,
        pdfPageNumber: null,
        objects: [],
      },
    },
    { status: 201 },
  );
});
