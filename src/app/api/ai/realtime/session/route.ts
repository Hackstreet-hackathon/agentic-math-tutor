import { z } from "zod";
import { createRealtimeSession } from "@/lib/server/ai/realtime";
import { json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

const schema = z.object({ notebookId: z.string().min(1).max(64), pageId: z.string().min(1).max(64), conversationId: z.string().min(1).max(64).nullish() });

/** Start a live voice call: returns a short-lived key for the browser plus the page context baked into the tutor's instructions. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, schema);
  return json(await createRealtimeSession({ userId: user.id, ...body }), { headers: { "Cache-Control": "no-store" } });
});
