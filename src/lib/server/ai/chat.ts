import type { Prisma } from "@/generated/prisma/client";
import { ANSWER_JSON_SCHEMA, answerFromPlainText, normalizeAnswer, type Answer, type Intent, type StoredAnswer, type Verification } from "@/lib/ai/answer";
import { parsePartialJson } from "@/lib/ai/partial-json";
import type { ChatMeta, ChatRequest } from "@/lib/ai/request";
import { routeIntent } from "@/lib/ai/router";
import { db } from "../db";
import { HttpError, notFound } from "../http";
import { rateLimit } from "../rate-limit";
import { env } from "../env";
import { buildAgentContext, summarizeContext } from "./context";
import { getLLM } from "./factory";
import { buildMessages, type HistoryTurn } from "./prompt";
import { ProviderError, type LLMProvider } from "./types";

export type ChatEvent =
  | { event: "meta"; data: ChatMeta }
  | { event: "partial"; data: { answer: Answer } }
  | { event: "final"; data: { messageId: string; answer: Answer; verification: Verification; malformed: boolean; usage: { promptTokens?: number; completionTokens?: number }; latencyMs: number } }
  | { event: "error"; data: { code: string; message: string; retryAfterSec?: number } };

const PARTIAL_INTERVAL_MS = 90;
const HISTORY_TURNS = 8;

/** Verification placeholder until deterministic checks run: never claims "verified". */
const UNVERIFIED: Verification = { status: "UNSUPPORTED", note: "AI-generated explanation; not independently verified." };

export function aiUnavailableError(reason: string): HttpError {
  const detail = process.env.NODE_ENV === "production" ? "" : ` (${reason})`;
  return new HttpError(503, `The AI tutor isn’t set up on this server yet.${detail}`, "ai_not_configured");
}

/** Validations that must fail as ordinary HTTP errors, before any streaming starts. */
export async function prepareChat(userId: string, body: ChatRequest) {
  const llm = getLLM();
  if (!llm.ok) throw aiUnavailableError(llm.reason);

  const rl = rateLimit(`ai:${userId}`, env().AI_RATE_LIMIT_PER_MIN);
  if (!rl.ok) throw new HttpError(429, `You’re sending questions quickly. Please wait ${rl.retryAfterSec}s and try again.`, "rate_limited");

  const page = await db.page.findFirst({ where: { id: body.pageId, notebookId: body.notebookId, notebook: { ownerId: userId } }, select: { id: true } });
  if (!page) throw notFound("Page");
  if (body.conversationId) {
    const c = await db.conversation.findFirst({ where: { id: body.conversationId, userId, notebookId: body.notebookId }, select: { id: true } });
    if (!c) throw notFound("Conversation");
  }
  return { provider: llm.provider, retryAfterSec: rl.retryAfterSec };
}

export async function* runChat(opts: { userId: string; body: ChatRequest; provider: LLMProvider; signal: AbortSignal }): AsyncGenerator<ChatEvent, void, void> {
  const { userId, body, provider, signal } = opts;

  // Prior turns (text only: we do not resend old contexts).
  const priorMessages = body.conversationId
    ? await db.message.findMany({ where: { conversationId: body.conversationId }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS, select: { role: true, content: true } })
    : [];
  const history: HistoryTurn[] = priorMessages
    .reverse()
    .filter((m) => m.role !== "SYSTEM")
    .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), text: m.content.slice(0, 1500) }));
  const hasPreviousAssistant = history.some((h) => h.role === "assistant");

  const hasSelection = Boolean(body.selection?.region || body.selection?.objectIds.length || body.selection?.text?.trim());
  const first = routeIntent({ message: body.message, explicitIntent: body.intent, hasSelection, hasPageContent: true, hasPreviousAssistantMessage: hasPreviousAssistant });
  const ctx = await buildAgentContext({ userId, body, intent: first.intent, hasPreviousAssistant });
  const route = routeIntent({ message: body.message, explicitIntent: body.intent, hasSelection, hasPageContent: ctx.hasPageContent, hasPreviousAssistantMessage: hasPreviousAssistant });
  const intent: Intent = route.intent;

  const visionOk = provider.capabilities.vision;
  const image = body.image ?? null;
  const imageSent = Boolean(image && visionOk);
  const context = summarizeContext(ctx, imageSent, image && !visionOk ? "no_vision" : null);

  const conversation = body.conversationId
    ? { id: body.conversationId }
    : await db.conversation.create({ data: { notebookId: body.notebookId, pageId: body.pageId, userId }, select: { id: true } });

  const contextMeta: Record<string, unknown> = { intent, routedVia: route.via, ...context };
  const userMessage = await db.message.create({
    data: { conversationId: conversation.id, role: "USER", content: body.message, contextMeta: { ...contextMeta, pageId: body.pageId } as Prisma.InputJsonValue },
    select: { id: true },
  });
  await db.conversation.update({ where: { id: conversation.id }, data: { pageId: body.pageId }, select: { id: true } });

  yield { event: "meta", data: { conversationId: conversation.id, userMessageId: userMessage.id, intent, routedVia: route.via, context } };

  // Nothing to act on: ask, don't guess, and don't spend a model call.
  if (route.clarification) {
    const answer: Answer = { ...answerFromPlainText("", intent), summary: "", needsClarification: route.clarification, confidence: "high" };
    const saved = await saveAssistant(conversation.id, { answer, verification: UNVERIFIED }, route.clarification, { ...contextMeta, clarification: true });
    yield { event: "final", data: { messageId: saved, answer, verification: UNVERIFIED, malformed: false, usage: {}, latencyMs: 0 } };
    return;
  }

  const { messages } = buildMessages({ ctx, intent, message: body.message, history, imageDataUrl: image, visionAvailable: visionOk });

  let text = "";
  let usage: { promptTokens?: number; completionTokens?: number } = {};
  let latencyMs = 0;
  let model = provider.model;
  try {
    const request = {
      messages,
      temperature: 0.2,
      responseFormat: "json_schema" as const,
      jsonSchema: { name: "tutor_answer", schema: ANSWER_JSON_SCHEMA as unknown as Record<string, unknown> },
      signal,
    };
    if (provider.capabilities.streaming) {
      let lastEmit = 0;
      let lastJson = "";
      for await (const ev of provider.stream(request)) {
        if (ev.type === "delta") {
          text += ev.text;
          const now = Date.now();
          if (now - lastEmit >= PARTIAL_INTERVAL_MS) {
            lastEmit = now;
            const partial = normalizeAnswer(parsePartialJson(text));
            const key = partial ? JSON.stringify(partial) : "";
            if (partial && key !== lastJson) {
              lastJson = key;
              yield { event: "partial", data: { answer: partial } };
            }
          }
        } else {
          usage = ev.result.usage;
          latencyMs = ev.result.latencyMs;
          model = ev.result.model;
          if (ev.result.text) text = ev.result.text;
        }
      }
    } else {
      const r = await provider.generate(request);
      text = r.text;
      usage = r.usage;
      latencyMs = r.latencyMs;
      model = r.model;
    }
  } catch (e) {
    if (e instanceof ProviderError) {
      if (e.kind === "cancelled") return;
      yield { event: "error", data: { code: `provider_${e.kind}`, message: e.message, retryAfterSec: e.retryAfterSec } };
      return;
    }
    console.error("chat failed:", e instanceof Error ? e.name : "unknown");
    yield { event: "error", data: { code: "internal", message: "Something went wrong while asking the AI tutor." } };
    return;
  }

  const { answer, malformed } = parseModelOutput(text, intent);
  const display = [answer.summary, answer.finalAnswer, answer.hint, answer.needsClarification].filter(Boolean).join("\n").slice(0, 4000);
  const stored: StoredAnswer = { answer, verification: UNVERIFIED, ...(malformed ? { malformed: true } : {}) };
  const messageId = await saveAssistant(conversation.id, stored, display || "(no text)", contextMeta, { provider: provider.id, model, usage, latencyMs });
  yield { event: "final", data: { messageId, answer, verification: UNVERIFIED, malformed, usage, latencyMs } };
}

/** Strict JSON first, then the first {...} block, then the raw text (flagged as malformed). */
export function parseModelOutput(text: string, intent: Intent): { answer: Answer; malformed: boolean } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const attempts: unknown[] = [];
  try {
    attempts.push(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        attempts.push(JSON.parse(trimmed.slice(start, end + 1)));
      } catch {
        /* fall through */
      }
    }
  }
  for (const a of attempts) {
    const ok = normalizeAnswer(a);
    if (ok) return { answer: ok, malformed: false };
  }
  return { answer: answerFromPlainText(trimmed || "The AI tutor returned an empty response. Please try again.", intent), malformed: true };
}

async function saveAssistant(
  conversationId: string,
  stored: StoredAnswer,
  content: string,
  contextMeta: object,
  meta: { provider?: string; model?: string; usage?: { promptTokens?: number; completionTokens?: number }; latencyMs?: number } = {},
): Promise<string> {
  const m = await db.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content,
      structured: stored as unknown as Prisma.InputJsonValue,
      contextMeta: contextMeta as Prisma.InputJsonValue,
      provider: meta.provider,
      model: meta.model,
      promptTokens: meta.usage?.promptTokens,
      completionTokens: meta.usage?.completionTokens,
      latencyMs: meta.latencyMs,
    },
    select: { id: true },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() }, select: { id: true } });
  return m.id;
}
