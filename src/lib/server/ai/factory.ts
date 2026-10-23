import { env } from "../env";
import { resolveCapabilities } from "./capabilities";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { LLMCapabilities, LLMProvider } from "./types";

export type LLMLookup = { ok: true; provider: LLMProvider } | { ok: false; reason: string };

let cached: { key: string; provider: LLMProvider } | undefined;

/** Server-side provider selection from validated env. Returns a reason (not an exception) when unconfigured. */
export function getLLM(): LLMLookup {
  const e = env();
  if (e.LLM_PROVIDER === "none") return { ok: false, reason: "No AI provider is configured (LLM_PROVIDER)." };

  const isGroq = e.LLM_PROVIDER === "groq";
  const apiKey = isGroq ? e.GROQ_API_KEY : e.OPENAI_API_KEY;
  const model = isGroq ? e.GROQ_MODEL : e.OPENAI_MODEL;
  if (!apiKey) return { ok: false, reason: `${isGroq ? "GROQ_API_KEY" : "OPENAI_API_KEY"} is not set.` };
  if (!model) return { ok: false, reason: `${isGroq ? "GROQ_MODEL" : "OPENAI_MODEL"} is not set.` };

  const key = `${e.LLM_PROVIDER}|${model}|${apiKey.length}|${e.OPENAI_BASE_URL ?? ""}`;
  if (cached?.key === key) return { ok: true, provider: cached.provider };

  const provider = new OpenAICompatibleProvider({
    id: e.LLM_PROVIDER as "openai" | "groq",
    baseUrl: isGroq ? "https://api.groq.com/openai/v1" : (e.OPENAI_BASE_URL ?? "https://api.openai.com/v1"),
    apiKey,
    model,
    capabilities: resolveCapabilities(e.LLM_PROVIDER as "openai" | "groq", model, {
      vision: e.LLM_SUPPORTS_VISION,
      jsonSchema: e.LLM_SUPPORTS_JSON_SCHEMA,
      jsonObject: e.LLM_SUPPORTS_JSON_OBJECT,
      streaming: e.LLM_SUPPORTS_STREAMING,
    }),
    timeoutMs: e.LLM_TIMEOUT_MS,
    maxOutputTokens: e.LLM_MAX_OUTPUT_TOKENS,
  });
  cached = { key, provider };
  return { ok: true, provider };
}

export interface AiStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  capabilities?: Pick<LLMCapabilities, "vision" | "streaming">;
  reason?: string;
}

/** Safe to return to the browser: never includes keys or base URLs. */
export function aiStatus(): AiStatus {
  const r = getLLM();
  if (!r.ok) return { configured: false, reason: r.reason };
  return { configured: true, provider: r.provider.id, model: r.provider.model, capabilities: { vision: r.provider.capabilities.vision, streaming: r.provider.capabilities.streaming } };
}
