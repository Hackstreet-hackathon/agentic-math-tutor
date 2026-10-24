import { randomBytes } from "node:crypto";
import type { ChatRequest } from "@/lib/ai/request";
import { db } from "../db";
import { env } from "../env";
import { HttpError, notFound } from "../http";
import { rateLimit } from "../rate-limit";
import { buildAgentContext } from "./context";
import { renderContext } from "./prompt";
import { OPENING_TASK, REALTIME_INSTRUCTIONS } from "@/lib/ai/realtime-prompt";

const HISTORY_TURNS = 10;

export interface RealtimeSession {
  /** Short-lived key the browser uses to open the WebRTC call; the real API key never leaves the server. */
  clientSecret: string;
  expiresAt: number;
  model: string;
  conversationId: string;
  /** Recent conversation to replay into the call so the tutor remembers it. */
  history: { role: "user" | "assistant"; text: string }[];
  /** The message that makes the tutor speak first (delivered as a normal message, not an instruction override). */
  openingTask: string;
}

/** Page (or selection) context as text for the model, fenced as untrusted document data. */
export async function realtimeContextText(opts: { userId: string; body: Pick<ChatRequest, "notebookId" | "pageId" | "selection"> & { message?: string } }): Promise<string> {
  const { userId, body } = opts;
  const ctx = await buildAgentContext({
    userId,
    body: { notebookId: body.notebookId, pageId: body.pageId, message: body.message ?? "context", intent: "explain", selection: body.selection ?? null } as ChatRequest,
    intent: "explain",
    hasPreviousAssistant: false,
  });
  const text = renderContext({ ctx, imageDataUrl: null, visionAvailable: false, boundary: randomBytes(8).toString("hex"), leading: [`<notebook title="${ctx.notebook.title.replace(/["<>]/g, "").slice(0, 80)}"/>`] });
  return `[context]\n${text}`;
}

export async function createRealtimeSession(opts: { userId: string; notebookId: string; pageId: string; conversationId?: string | null }): Promise<RealtimeSession> {
  const { userId, notebookId, pageId } = opts;
  const e = env();
  if (!e.OPENAI_API_KEY) throw new HttpError(503, "Voice isn’t set up on this server.", "ai_not_configured");
  const rl = rateLimit(`realtime:${userId}`, 8);
  if (!rl.ok) throw new HttpError(429, `Please wait ${rl.retryAfterSec}s before starting the voice call again.`, "rate_limited");

  const page = await db.page.findFirst({ where: { id: pageId, notebookId, notebook: { ownerId: userId } }, select: { id: true } });
  if (!page) throw notFound("Page");

  let conversationId = opts.conversationId ?? null;
  if (conversationId) {
    const c = await db.conversation.findFirst({ where: { id: conversationId, userId, notebookId }, select: { id: true } });
    if (!c) conversationId = null;
  }
  if (!conversationId) {
    conversationId = (await db.conversation.create({ data: { notebookId, pageId, userId }, select: { id: true } })).id;
  }

  const [prior, contextText] = await Promise.all([
    db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS, select: { role: true, content: true } }),
    realtimeContextText({ userId, body: { notebookId, pageId } }),
  ]);
  const history = prior
    .reverse()
    .filter((m) => m.role !== "SYSTEM")
    .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), text: m.content.slice(0, 1200) }));

  const model = e.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
  const body = JSON.stringify({
    session: {
      type: "realtime",
      model,
      instructions: `${REALTIME_INSTRUCTIONS}\n\n${contextText}`,
      output_modalities: ["audio"],
      max_output_tokens: 700,
      audio: {
        input: {
          transcription: { model: "gpt-4o-transcribe", language: "en" },
          noise_reduction: { type: "near_field" },
          turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true },
        },
        output: { voice: e.OPENAI_REALTIME_VOICE ?? "marin" },
      },
    },
  });
  let res: Response | undefined;
  // The connection to OpenAI occasionally fails outright; one retry hides that from the student.
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try {
      res = await fetch(`${e.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error("realtime session request failed:", err instanceof Error ? err.name : "unknown", attempt === 0 ? "(retrying)" : "");
      if (attempt === 1) throw new HttpError(502, "The voice service could not be reached.", "realtime_unreachable");
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!res) throw new HttpError(502, "The voice service could not be reached.", "realtime_unreachable");
  if (!res.ok) throw new HttpError(502, `The voice service refused the call (${res.status}).`, "realtime_failed");
  const j = (await res.json()) as { value?: string; expires_at?: number };
  if (!j.value) throw new HttpError(502, "The voice service did not return a session.", "realtime_failed");

  return { clientSecret: j.value, expiresAt: j.expires_at ?? 0, model, conversationId, history, openingTask: OPENING_TASK };
}

/** Save one finished turn of a live call so the conversation shows up in the tutor panel after a reload. */
export async function logRealtimeTurn(opts: { userId: string; conversationId: string; notebookId: string; role: "user" | "assistant"; text: string; pageId?: string }) {
  const { userId, conversationId, notebookId, role, text } = opts;
  const c = await db.conversation.findFirst({ where: { id: conversationId, userId, notebookId }, select: { id: true } });
  if (!c) throw notFound("Conversation");
  const clean = text.trim().slice(0, 4000);
  if (!clean) return;
  await db.message.create({ data: { conversationId, role: role === "user" ? "USER" : "ASSISTANT", content: clean, contextMeta: { via: "realtime", pageId: opts.pageId ?? null } }, select: { id: true } });
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() }, select: { id: true } });
}
