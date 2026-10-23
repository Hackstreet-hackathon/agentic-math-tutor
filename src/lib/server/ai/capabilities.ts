import type { LLMCapabilities } from "./types";

export interface CapabilityOverrides {
  vision?: string;
  jsonSchema?: string;
  jsonObject?: string;
  streaming?: string;
}

const bool = (v: string | undefined): boolean | undefined => (v === "true" ? true : v === "false" ? false : undefined);

/**
 * Best-effort capability table. Model catalogues change quickly, so this only encodes
 * well-known families and is deliberately conservative: unknown models get streaming
 * but no vision and no strict JSON schema. Operators can override per deployment with
 * LLM_SUPPORTS_* environment variables, and the adapter also downgrades at runtime when a
 * provider rejects a feature.
 */
export function resolveCapabilities(provider: "openai" | "groq", model: string, o: CapabilityOverrides = {}): LLMCapabilities {
  const m = model.toLowerCase();
  let caps: LLMCapabilities;

  if (provider === "openai") {
    const reasoning = /^(o\d|gpt-5)/.test(m);
    const modern = /^(gpt-4o|gpt-4\.1|gpt-5|o\d)/.test(m);
    const vision =
      /^(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o4)/.test(m) || /^o1$|^o1-2/.test(m) || /^o3$|^o3-2/.test(m) || /^o3-pro/.test(m);
    caps = {
      streaming: true,
      vision,
      jsonSchema: modern && !/^o1-(mini|preview)/.test(m),
      jsonObject: /^(gpt-4|gpt-3\.5-turbo-1106|gpt-3\.5-turbo-0125|o\d|gpt-5)/.test(m),
      temperature: !reasoning,
    };
  } else {
    caps = {
      streaming: true,
      vision: /llama-4|scout|maverick|vision/.test(m),
      jsonSchema: /gpt-oss|llama-4|kimi/.test(m),
      jsonObject: true,
      temperature: true,
    };
  }

  return {
    streaming: bool(o.streaming) ?? caps.streaming,
    vision: bool(o.vision) ?? caps.vision,
    jsonSchema: bool(o.jsonSchema) ?? caps.jsonSchema,
    jsonObject: bool(o.jsonObject) ?? caps.jsonObject,
    temperature: caps.temperature,
  };
}
