/** Provider-neutral LLM types. Adapters translate to/from each vendor's wire format. */
export type ContentPart = { type: "text"; text: string } | { type: "image"; dataUrl: string };

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export type ResponseFormat = "json_schema" | "json_object" | "text";

export interface LLMRequest {
  messages: LLMMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: ResponseFormat;
  /** JSON schema used when responseFormat = "json_schema". */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Abort to cancel the upstream request (client navigated away, newer request, ...). */
  signal?: AbortSignal;
}

export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface LLMResult {
  text: string;
  usage: LLMUsage;
  model: string;
  finishReason?: string;
  latencyMs: number;
}

export type LLMStreamEvent = { type: "delta"; text: string } | { type: "done"; result: LLMResult };

export interface LLMCapabilities {
  streaming: boolean;
  vision: boolean;
  jsonSchema: boolean;
  jsonObject: boolean;
  /** Reasoning models reject custom temperature. */
  temperature: boolean;
}

export interface LLMProvider {
  readonly id: "openai" | "gemini";
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  generate(req: LLMRequest): Promise<LLMResult>;
  stream(req: LLMRequest): AsyncGenerator<LLMStreamEvent, void, void>;
}

export type ProviderErrorKind = "auth" | "rate_limit" | "timeout" | "bad_request" | "unavailable" | "cancelled" | "unknown";

/** Error whose `message` is safe to show to the student (never contains keys or request bodies). */
export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public status?: number,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}
