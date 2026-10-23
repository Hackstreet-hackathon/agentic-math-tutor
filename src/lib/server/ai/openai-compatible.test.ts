import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM test helper without types
import { startFakeLlm } from "../../../../scripts/fake-llm.mjs";
import { resolveCapabilities } from "./capabilities";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { ProviderError, type LLMRequest } from "./types";

type Fake = { port: number; url: string; requests: { auth: string | null; body: Record<string, unknown>; aborted: boolean }[]; close: () => Promise<void> };
let fake: Fake;
beforeAll(async () => {
  fake = await startFakeLlm(0);
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
});

const make = (over: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}) =>
  new OpenAICompatibleProvider({
    id: "openai",
    baseUrl: fake.url,
    apiKey: "sk-test-secret",
    model: "gpt-4o-mini",
    capabilities: resolveCapabilities("openai", "gpt-4o-mini"),
    timeoutMs: 5_000,
    maxOutputTokens: 500,
    ...over,
  });
const req = (text: string, extra: Partial<LLMRequest> = {}): LLMRequest => ({ messages: [{ role: "system", content: "sys" }, { role: "user", content: text }], ...extra });

describe("OpenAICompatibleProvider", () => {
  it("streams deltas, reassembles the text and reports usage", async () => {
    const deltas: string[] = [];
    let done;
    for await (const ev of make().stream(req("hello <intent>explain</intent>"))) {
      if (ev.type === "delta") deltas.push(ev.text);
      else done = ev.result;
    }
    expect(deltas.length).toBeGreaterThan(3);
    expect(JSON.parse(deltas.join("")).intent).toBe("explain");
    expect(done).toMatchObject({ usage: { promptTokens: 111, completionTokens: 222 }, model: "gpt-4o-mini", finishReason: "stop" });
    expect(fake.requests[0]!.auth).toBe("Bearer sk-test-secret");
  });

  it("supports non-streaming generate()", async () => {
    const r = await make().generate(req("hi"));
    expect(JSON.parse(r.text)).toHaveProperty("summary");
    expect(r.usage.completionTokens).toBe(222);
  });

  it("requests strict JSON schema only when the model supports it", async () => {
    const schema = { name: "answer", schema: { type: "object" } };
    await make().generate(req("x", { responseFormat: "json_schema", jsonSchema: schema }));
    expect((fake.requests[0]!.body.response_format as { type: string }).type).toBe("json_schema");

    fake.requests.length = 0;
    const old = make({ model: "mystery-model", capabilities: resolveCapabilities("openai", "mystery-model") });
    await old.generate(req("x", { responseFormat: "json_schema", jsonSchema: schema }));
    expect(fake.requests[0]!.body.response_format).toBeUndefined();
  });

  it("downgrades and remembers when the provider rejects response_format", async () => {
    const p = make();
    const schema = { name: "answer", schema: { type: "object" } };
    const r = await p.generate(req("__NOJSONMODE__", { responseFormat: "json_schema", jsonSchema: schema }));
    expect(r.text).toBeTruthy();
    // json_schema -> json_object (still rejected) -> text: three upstream calls, then remembered
    expect(fake.requests.length).toBe(3);
    expect(p.capabilities.jsonSchema).toBe(false);
    expect(p.capabilities.jsonObject).toBe(false);
  });

  it("strips images for models without vision and keeps them for models with it", async () => {
    const msg: LLMRequest = { messages: [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", dataUrl: "data:image/png;base64,AAAA" }] }] };
    await make({ capabilities: { ...resolveCapabilities("openai", "gpt-4o-mini"), vision: false } }).generate(msg);
    expect(JSON.stringify(fake.requests[0]!.body.messages)).not.toContain("image_url");
    await make().generate(msg);
    expect(JSON.stringify(fake.requests[1]!.body.messages)).toContain("image_url");
  });

  it("omits temperature for reasoning models", async () => {
    await make({ model: "o3-mini", capabilities: resolveCapabilities("openai", "o3-mini") }).generate(req("x", { temperature: 0.2 }));
    expect(fake.requests[0]!.body.temperature).toBeUndefined();
    await make().generate(req("x", { temperature: 0.2 }));
    expect(fake.requests[1]!.body.temperature).toBe(0.2);
  });

  it.each([
    ["__AUTH__", "auth", 401],
    ["__RATE__", "rate_limit", 429],
    ["__500__", "unavailable", 503],
  ] as const)("maps %s to a %s error without leaking secrets", async (trigger, kind, status) => {
    const err = await make().generate(req(trigger)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind, status });
    expect(err.message).not.toMatch(/sk-|Incorrect API key/);
    if (kind === "rate_limit") expect(err.retryAfterSec).toBe(2);
  });

  it("times out hung providers", async () => {
    const t0 = Date.now();
    const err = await make({ timeoutMs: 400 }).generate(req("__TIMEOUT__")).catch((e) => e);
    expect(err).toMatchObject({ kind: "timeout" });
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it("cancels the upstream request when the caller aborts", async () => {
    const ac = new AbortController();
    const it = make().stream(req("__TIMEOUT__", { signal: ac.signal }));
    const pending = it.next().catch((e) => e);
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    expect(await pending).toMatchObject({ kind: "cancelled" });
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.requests[0]!.aborted).toBe(true);
  });

  it("reports an unreachable provider clearly", async () => {
    const err = await make({ baseUrl: "http://127.0.0.1:1/v1" }).generate(req("x")).catch((e) => e);
    expect(err).toMatchObject({ kind: "unavailable" });
  });
});

describe("resolveCapabilities", () => {
  it("knows common families and stays conservative otherwise", () => {
    expect(resolveCapabilities("openai", "gpt-4o")).toMatchObject({ vision: true, jsonSchema: true, temperature: true });
    expect(resolveCapabilities("openai", "gpt-4o-mini").vision).toBe(true);
    expect(resolveCapabilities("openai", "o3-mini")).toMatchObject({ vision: false, jsonSchema: true, temperature: false });
    expect(resolveCapabilities("openai", "gpt-3.5-turbo")).toMatchObject({ vision: false, jsonSchema: false });
    expect(resolveCapabilities("openai", "totally-new-model")).toMatchObject({ streaming: true, vision: false, jsonSchema: false });
    expect(resolveCapabilities("groq", "meta-llama/llama-4-scout-17b-16e-instruct")).toMatchObject({ vision: true, jsonSchema: true });
    expect(resolveCapabilities("groq", "llama-3.3-70b-versatile")).toMatchObject({ vision: false, jsonSchema: false, jsonObject: true });
  });
  it("honours explicit overrides", () => {
    expect(resolveCapabilities("openai", "totally-new-model", { vision: "true", jsonSchema: "true" })).toMatchObject({ vision: true, jsonSchema: true });
    expect(resolveCapabilities("openai", "gpt-4o", { vision: "false" }).vision).toBe(false);
  });
});
