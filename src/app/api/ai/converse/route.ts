import { converseRequestSchema } from "@/lib/ai/converse";
import { prepareConverse, runConverse } from "@/lib/server/ai/converse";
import { env } from "@/lib/server/env";
import { HttpError, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const maxDuration = 120;

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * One spoken turn of the voice conversation. SSE: meta -> (ack) -> sentence* -> (state) -> done, or control / error.
 * Small talk is answered by the fast model; maths by the main tutor model with the circled selection as context.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, converseRequestSchema);
  const { main, fast } = await prepareConverse(user.id, body);

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const hardStop = setTimeout(() => abort.abort(), env().LLM_TIMEOUT_MS + 15_000);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of runConverse({ userId: user.id, body, main, fast, signal: abort.signal })) {
          if (abort.signal.aborted) break;
          controller.enqueue(sse(ev.event, ev.data));
        }
      } catch (e) {
        if (e instanceof HttpError) controller.enqueue(sse("error", { code: e.code, message: e.message }));
        else {
          console.error("converse stream failed:", e instanceof Error ? e.name : "unknown");
          controller.enqueue(sse("error", { code: "internal", message: "Something went wrong while talking to the tutor." }));
        }
      } finally {
        clearTimeout(hardStop);
        try {
          controller.close();
        } catch {
          /* client already disconnected */
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
