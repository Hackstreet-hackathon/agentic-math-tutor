import { watchRequestSchema } from "@/lib/ai/watch";
import { env } from "@/lib/server/env";
import { json, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prepareWatch, runWatch } from "@/lib/server/ai/watch";

export const maxDuration = 60;

/** Silent check of the student's current working. Returns a flag (or nothing); persists no messages. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, watchRequestSchema);
  const { provider } = await prepareWatch(user.id, body);
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const hardStop = setTimeout(() => abort.abort(), env().LLM_TIMEOUT_MS + 5_000);
  try {
    return json(await runWatch({ userId: user.id, body, provider, signal: abort.signal }));
  } finally {
    clearTimeout(hardStop);
  }
});
