import { ProviderError, type LLMCapabilities, type LLMMessage, type LLMProvider, type LLMRequest, type LLMResult, type LLMStreamEvent, type ResponseFormat } from "./types";

export interface OpenAICompatibleConfig {
  id: "openai" | "gemini";
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities: LLMCapabilities;
  timeoutMs: number;
  maxOutputTokens: number;
}

/**
 * Chat Completions client for OpenAI and any OpenAI-compatible API (Gemini, ...).
 * - Streams over SSE and reports token usage when the provider sends it.
 * - Honours caller cancellation and a hard timeout.
 * - Downgrades json_schema -> json_object -> plain when the provider rejects the mode.
 * Error messages are safe to show to students; keys and bodies are never included.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: "openai" | "gemini";
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  private cfg: OpenAICompatibleConfig;

  constructor(cfg: OpenAICompatibleConfig) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.model = cfg.model;
    this.capabilities = { ...cfg.capabilities }; // mutable: runtime downgrades are remembered
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    let text = "";
    let result: LLMResult | undefined;
    for await (const ev of this.run(req, false)) {
      if (ev.type === "delta") text += ev.text;
      else result = ev.result;
    }
    if (!result) throw new ProviderError("unknown", "The AI provider returned no response.");
    return { ...result, text: result.text || text };
  }

  stream(req: LLMRequest): AsyncGenerator<LLMStreamEvent, void, void> {
    return this.run(req, this.capabilities.streaming);
  }

  private pickFormat(req: LLMRequest): ResponseFormat {
    const want = req.responseFormat ?? "text";
    if (want === "json_schema") {
      if (this.capabilities.jsonSchema && req.jsonSchema) return "json_schema";
      return this.capabilities.jsonObject ? "json_object" : "text";
    }
    if (want === "json_object") return this.capabilities.jsonObject ? "json_object" : "text";
    return "text";
  }

  private buildBody(req: LLMRequest, format: ResponseFormat, stream: boolean) {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: req.messages.map((m) => toWire(m, this.capabilities.vision)),
      max_completion_tokens: req.maxOutputTokens ?? this.cfg.maxOutputTokens,
      stream,
    };
    if (stream) body.stream_options = { include_usage: true };
    if (this.capabilities.temperature && req.temperature !== undefined) body.temperature = req.temperature;
    if (format === "json_schema" && req.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    } else if (format === "json_object") {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  private async *run(req: LLMRequest, stream: boolean): AsyncGenerator<LLMStreamEvent, void, void> {
    const started = Date.now();
    let format = this.pickFormat(req);

    for (let attempt = 0; attempt < 3; attempt++) {
      const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
          body: JSON.stringify(this.buildBody(req, format, stream)),
          signal,
        });
      } catch (e) {
        throw this.mapAbort(e, req.signal, timeout) ?? new ProviderError("unavailable", "Could not reach the AI provider.");
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        // Provider rejected the structured-output mode: remember and retry one level down.
        if (res.status === 400 && /response_format|json_schema|json_object|structured/i.test(detail) && format !== "text") {
          if (format === "json_schema") {
            this.capabilities.jsonSchema = false;
            format = this.capabilities.jsonObject ? "json_object" : "text";
          } else {
            this.capabilities.jsonObject = false;
            format = "text";
          }
          continue;
        }
        throw httpError(res.status, res.headers.get("retry-after"), detail);
      }

      try {
        if (!stream || !res.body) {
          const json = (await res.json()) as ChatCompletion;
          const text = json.choices?.[0]?.message?.content ?? "";
          yield { type: "done", result: toResult(text, json.usage, json.model ?? this.model, json.choices?.[0]?.finish_reason, started) };
          return;
        }
        yield* this.readStream(res.body, started);
        return;
      } catch (e) {
        throw this.mapAbort(e, req.signal, timeout) ?? (e instanceof ProviderError ? e : new ProviderError("unavailable", "The AI provider connection was interrupted."));
      }
    }
    throw new ProviderError("bad_request", "The AI provider rejected the request.");
  }

  private async *readStream(body: ReadableStream<Uint8Array>, started: number): AsyncGenerator<LLMStreamEvent, void, void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage: ChatCompletion["usage"];
    let model = this.model;
    let finish: string | undefined;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk: ChatChunk;
            try {
              chunk = JSON.parse(data) as ChatChunk;
            } catch {
              continue; // ignore keep-alives / malformed frames
            }
            if (chunk.error) throw httpError(chunk.error.code === "rate_limit_exceeded" ? 429 : 502, null, chunk.error.message ?? "");
            if (chunk.model) model = chunk.model;
            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (choice?.finish_reason) finish = choice.finish_reason;
            const delta = choice?.delta?.content;
            if (delta) {
              text += delta;
              yield { type: "delta", text: delta };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", result: toResult(text, usage, model, finish, started) };
  }

  private mapAbort(e: unknown, caller: AbortSignal | undefined, timeout: AbortSignal): ProviderError | null {
    if (caller?.aborted) return new ProviderError("cancelled", "Request cancelled.");
    if (timeout.aborted) return new ProviderError("timeout", "The AI provider took too long to respond. Please try again.");
    const name = (e as { name?: string })?.name;
    if (name === "AbortError" || name === "TimeoutError") return new ProviderError("timeout", "The AI provider took too long to respond. Please try again.");
    return null;
  }
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface ChatChunk {
  model?: string;
  error?: { message?: string; code?: string };
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function toResult(text: string, usage: ChatCompletion["usage"] | null | undefined, model: string, finish: string | null | undefined, started: number): LLMResult {
  return {
    text,
    model,
    finishReason: finish ?? undefined,
    latencyMs: Date.now() - started,
    usage: { promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens },
  };
}

function toWire(m: LLMMessage, vision: boolean) {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  const parts = m.content.flatMap<Record<string, unknown>>((p) => {
    if (p.type === "text") return [{ type: "text", text: p.text }];
    return vision ? [{ type: "image_url", image_url: { url: p.dataUrl } }] : []; // never send images to a model that cannot read them
  });
  return { role: m.role, content: parts };
}

function httpError(status: number, retryAfter: string | null, detail: string): ProviderError {
  const retry = retryAfter && Number.isFinite(Number(retryAfter)) ? Math.ceil(Number(retryAfter)) : undefined;
  if (status === 401 || status === 403) return new ProviderError("auth", "The AI provider rejected the server’s API key. An administrator needs to check the configuration.", status);
  if (status === 429) return new ProviderError("rate_limit", "The AI provider is rate-limiting requests right now. Please try again shortly.", status, retry);
  if (status === 408 || status === 504) return new ProviderError("timeout", "The AI provider took too long to respond. Please try again.", status);
  if (status >= 500) return new ProviderError("unavailable", "The AI provider is temporarily unavailable. Please try again.", status);
  // 4xx: keep the provider's reason only for logs; do not echo request/response bodies to the UI.
  void detail;
  return new ProviderError("bad_request", "The AI provider could not process this request.", status);
}
