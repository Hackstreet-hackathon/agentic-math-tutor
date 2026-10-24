import { z } from "zod";
import { logRealtimeTurn } from "@/lib/server/ai/realtime";
import { HttpError, json, parseJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/session";

const schema = z.object({
  conversationId: z.string().min(1).max(64),
  notebookId: z.string().min(1).max(64),
  pageId: z.string().min(1).max(64).optional(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(6000),
});

/** Persist a finished turn of a live voice call (so it is in the tutor panel after a reload). */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, schema);
  if (!rateLimit(`rtlog:${user.id}`, 120).ok) throw new HttpError(429, "Too many messages.", "rate_limited");
  await logRealtimeTurn({ userId: user.id, ...body });
  return json({ ok: true });
});
