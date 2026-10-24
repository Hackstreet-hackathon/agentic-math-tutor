import { describe, expect, it } from "vitest";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.DATABASE_URL = "postgresql://x";
const { looksLikeNoSpeech } = await import("./stt");

describe("looksLikeNoSpeech", () => {
  it("rejects Whisper's inventions on silence", () => {
    expect(looksLikeNoSpeech([{ no_speech_prob: 0.9, avg_logprob: -1.5 }])).toBe(true);
    expect(looksLikeNoSpeech([{ no_speech_prob: 0.4, avg_logprob: -1.6 }])).toBe(true);
    expect(looksLikeNoSpeech([{ no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 3.4 }])).toBe(true);
  });
  it("keeps real speech, including a quiet but confident one", () => {
    expect(looksLikeNoSpeech([{ no_speech_prob: 0.05, avg_logprob: -0.25, compression_ratio: 1.2 }])).toBe(false);
    expect(looksLikeNoSpeech([{ no_speech_prob: 0.7 }, { no_speech_prob: 0.05, avg_logprob: -0.3 }])).toBe(false);
    expect(looksLikeNoSpeech(undefined)).toBe(false);
  });
});
