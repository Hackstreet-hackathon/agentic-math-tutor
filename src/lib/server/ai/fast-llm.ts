import { env } from "../env";
import { resolveCapabilities } from "./capabilities";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { LLMCapabilities, LLMProvider } from "./types";

let cached: { key: string; provider: LLMProvider } | undefined;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * The small, fast model used by the voice conversation for triage and small talk.
 * Falls back to OpenAI gpt-4o-mini on the main key when the chosen provider has no key; null when nothing works.
 */
export function getFastLLM(): LLMProvider | null {
  const e = env();
  let choice = e.FAST_LLM_PROVIDER;
  if (choice === "none") return null;
  if (choice === "gemini" && !e.GEMINI_API_KEY) choice = "openai";
  if (choice === "openai" && !e.OPENAI_API_KEY) return null;

  const cfg =
    choice === "gemini"
      ? { id: "gemini" as const, baseUrl: GEMINI_BASE, apiKey: e.GEMINI_API_KEY!, model: e.FAST_LLM_MODEL ?? "gemini-2.5-flash-lite" }
      : { id: "openai" as const, baseUrl: e.OPENAI_BASE_URL ?? "https://api.openai.com/v1", apiKey: e.OPENAI_API_KEY!, model: e.FAST_LLM_PROVIDER === "openai" && e.FAST_LLM_MODEL ? e.FAST_LLM_MODEL : "gpt-4o-mini" };

  const key = `${cfg.id}|${cfg.model}|${cfg.apiKey.length}|${cfg.baseUrl}`;
  if (cached?.key === key) return cached.provider;

  const capabilities: LLMCapabilities =
    cfg.id === "gemini"
      ? { streaming: true, vision: false, jsonSchema: false, jsonObject: true, temperature: true }
      : resolveCapabilities(cfg.id, cfg.model);

  const provider = new OpenAICompatibleProvider({ ...cfg, capabilities, timeoutMs: 20_000, maxOutputTokens: 400 });
  cached = { key, provider };
  return provider;
}
