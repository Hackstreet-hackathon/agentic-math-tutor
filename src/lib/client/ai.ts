import type { Answer, Verification } from "@/lib/ai/answer";
import type { ChatMeta, ChatRequest } from "@/lib/ai/request";
import type { WatchRequest, WatchResponse } from "@/lib/ai/watch";
import type { ConverseRequest, TutorState } from "@/lib/ai/converse";

export interface AiStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  capabilities?: { vision: boolean; streaming: boolean };
  reason?: string;
}

export interface ChatFinal {
  messageId: string;
  answer: Answer;
  verification: Verification;
  malformed: boolean;
  usage: { promptTokens?: number; completionTokens?: number };
  latencyMs: number;
}

export class ChatError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

export interface ChatHandlers {
  onMeta?: (m: ChatMeta) => void;
  onPartial?: (a: Answer) => void;
}

export async function getAiStatus(): Promise<AiStatus> {
  const res = await fetch("/api/ai/status");
  if (!res.ok) throw new Error("Could not check the AI tutor");
  return (await res.json()) as AiStatus;
}

export interface StoredMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  structured: { answer: Answer; verification: Verification; malformed?: boolean } | null;
  contextMeta: (Partial<ChatMeta["context"]> & { intent?: string; pageId?: string }) | null;
  createdAt: string;
}

export async function getConversation(notebookId: string): Promise<{ id: string; messages: StoredMessage[] } | null> {
  const res = await fetch(`/api/notebooks/${notebookId}/conversation`);
  if (!res.ok) throw new Error("Could not load the conversation");
  return ((await res.json()) as { conversation: { id: string; messages: StoredMessage[] } | null }).conversation;
}

/** POST /api/ai/chat and consume the SSE stream. Resolves with the final answer; throws ChatError. */
export async function streamChat(body: ChatRequest, handlers: ChatHandlers, signal: AbortSignal): Promise<ChatFinal> {
  let res: Response;
  try {
    res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ChatError("Network error. Check your connection and try again.", "network");
  }
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new ChatError(j?.error?.message ?? `The AI tutor is unavailable (${res.status}).`, j?.error?.code ?? "http", Number(res.headers.get("Retry-After")) || undefined);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: ChatFinal | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload = JSON.parse(data) as unknown;
      if (event === "meta") handlers.onMeta?.(payload as ChatMeta);
      else if (event === "partial") handlers.onPartial?.((payload as { answer: Answer }).answer);
      else if (event === "final") final = payload as ChatFinal;
      else if (event === "error") {
        const e = payload as { code: string; message: string; retryAfterSec?: number };
        throw new ChatError(e.message, e.code, e.retryAfterSec);
      }
    }
  }
  if (!final) throw new ChatError("The answer was cut off. Please try again.", "incomplete");
  return final;
}

/** Silent "watch my work" check. Throws ChatError (with code) on failure. */
export async function watchWork(body: WatchRequest, signal: AbortSignal): Promise<WatchResponse> {
  let res: Response;
  try {
    res = await fetch("/api/ai/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ChatError("Network error.", "network");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new ChatError(j?.error?.message ?? `Work tracking failed (${res.status}).`, j?.error?.code ?? "http", Number(res.headers.get("Retry-After")) || undefined);
  }
  return (await res.json()) as WatchResponse;
}

export interface ConverseHandlers {
  onMeta?: (m: { conversationId: string; kind: "smalltalk" | "math" | "control"; model: string }) => void;
  onAck?: (text: string) => void;
  onSentence?: (text: string) => void;
  onState?: (s: TutorState) => void;
  onControl?: (c: "stop" | "repeat" | "stop_listening") => void;
}

/** POST /api/ai/converse and dispatch its SSE events as they arrive. Throws ChatError (or AbortError). */
export async function streamConverse(body: ConverseRequest, h: ConverseHandlers, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/ai/converse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ChatError("Network error. Check your connection and try again.", "network");
  }
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new ChatError(j?.error?.message ?? `The tutor is unavailable (${res.status}).`, j?.error?.code ?? "http", Number(res.headers.get("Retry-After")) || undefined);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const p = JSON.parse(data) as Record<string, unknown>;
      if (event === "meta") h.onMeta?.(p as never);
      else if (event === "ack") h.onAck?.(p.text as string);
      else if (event === "sentence") h.onSentence?.(p.text as string);
      else if (event === "state") h.onState?.(p.tutorState as TutorState);
      else if (event === "control") h.onControl?.(p.control as never);
      else if (event === "error") throw new ChatError(String(p.message ?? "The tutor ran into a problem."), String(p.code ?? "error"), p.retryAfterSec as number | undefined);
    }
  }
}
