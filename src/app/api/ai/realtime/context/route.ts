import { z } from "zod";
import { chatRequestSchema } from "@/lib/ai/request";
import { realtimeContextText } from "@/lib/server/ai/realtime";
import { json, parseJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

const schema = z.object({ notebookId: z.string().min(1).max(64), pageId: z.string().min(1).max(64), selection: chatRequestSchema.shape.selection });

/** Text description of the page (and of what is circled/selected) to feed into a live call. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, schema);
  const rl = rateLimit(`rtctx:${user.id}`, 60);
  if (!rl.ok) throw new HttpError(429, "Too many context updates.", "rate_limited");
  return json({ text: await realtimeContextText({ userId: user.id, body: { ...body, message: "context" } }) });
});
