import { afterEach, describe, expect, it, vi } from "vitest";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.DATABASE_URL = "postgresql://x";
process.env.OPENAI_API_KEY = "sk-test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(provider: string) {
  vi.resetModules();
  process.env.TTS_PROVIDER = provider;
  return import("./tts");
}

describe("synthesizeSpeech", () => {
  it("returns null only when speech is switched off", async () => {
    const { synthesizeSpeech } = await load("none");
    expect(await synthesizeSpeech("hi")).toBeNull();
  });

  it("reports a provider failure as a 502, not as 'not configured'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { synthesizeSpeech } = await load("openai");
    await expect(synthesizeSpeech("hi")).rejects.toMatchObject({ status: 502, code: "tts_failed" });
  });

  it("reports an unreachable provider as a 502 too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network"))));
    const { synthesizeSpeech } = await load("openai");
    await expect(synthesizeSpeech("hi")).rejects.toMatchObject({ status: 502, code: "tts_unreachable" });
  });

  it("passes the audio through on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("audio", { status: 200 })));
    const { synthesizeSpeech } = await load("openai");
    expect(await (await synthesizeSpeech("hi"))!.text()).toBe("audio");
  });
});
