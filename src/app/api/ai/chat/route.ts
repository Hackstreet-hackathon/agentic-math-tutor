import { chatRequestSchema } from "@/lib/ai/request";
import { prepareChat, runChat } from "@/lib/server/ai/chat";
import { env } from "@/lib/server/env";
import { HttpError, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const maxDuration = 120;

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Ask the AI tutor. Responds as a Server-Sent Events stream:
 *   meta -> partial* -> final    (or error)
 * Validation, auth, rate limiting and "AI not configured" fail as normal JSON errors before the stream starts.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, chatRequestSchema);
  const { provider } = await prepareChat(user.id, body);

  // Cancel upstream work when the client disconnects, and never run longer than the configured limit.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const hardStop = setTimeout(() => abort.abort(), env().LLM_TIMEOUT_MS + 15_000);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of runChat({ userId: user.id, body, provider, signal: abort.signal })) {
          if (abort.signal.aborted) break;
          controller.enqueue(sse(ev.event, ev.data));
        }
      } catch (e) {
        if (e instanceof HttpError) controller.enqueue(sse("error", { code: e.code, message: e.message }));
        else {
          console.error("chat stream failed:", e instanceof Error ? e.name : "unknown");
          controller.enqueue(sse("error", { code: "internal", message: "Something went wrong while asking the AI tutor." }));
        }
      } finally {
        clearTimeout(hardStop);
        try {
          controller.close();
        } catch {
          /* already closed by a client disconnect */
        }
      }
    },
    cancel() {
      abort.abort();
      clearTimeout(hardStop);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
});
