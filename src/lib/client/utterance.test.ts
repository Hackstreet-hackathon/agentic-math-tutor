import { describe, expect, it } from "vitest";
import { looksUnfinished } from "./utterance";

describe("looksUnfinished", () => {
  it("spots a sentence cut off mid-thought, even when Whisper adds punctuation", () => {
    for (const t of ["How do I", "How do I?", "What is the derivative of", "so the answer is", "I think it's...", "and then", "can you", "um,"]) expect(looksUnfinished(t)).toBe(true);
  });
  it("lets complete sentences through immediately", () => {
    for (const t of ["How do I solve this?", "Is it two and three?", "x equals four", "I don't know", "Why does that work", "Stop", "yes"]) expect(looksUnfinished(t)).toBe(false);
  });
  it("handles empty text", () => {
    expect(looksUnfinished("")).toBe(false);
    expect(looksUnfinished("   ")).toBe(false);
  });
});
