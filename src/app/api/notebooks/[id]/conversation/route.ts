import { ownedNotebook } from "@/lib/server/access";
import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** The most recent AI conversation for this notebook, oldest message first. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  await ownedNotebook(user.id, id);
  const conversation = await db.conversation.findFirst({
    where: { notebookId: id, userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { id: true, role: true, content: true, structured: true, contextMeta: true, createdAt: true },
      },
    },
  });
  if (!conversation) return json({ conversation: null });
  return json({ conversation: { id: conversation.id, messages: conversation.messages.reverse() } });
});
