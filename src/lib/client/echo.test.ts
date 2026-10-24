import { describe, expect, it } from "vitest";
import { isEcho } from "./echo";

const tutor = ["Hello! What are you learning in maths today?", "Feel free to tell me if you have any specific questions."];

describe("isEcho", () => {
  it("catches the tutor hearing itself, even partly garbled", () => {
    expect(isEcho("What are you learning in maths today?", tutor)).toBe(true);
    expect(isEcho("what are you learning in math today feel free to tell me", tutor)).toBe(true);
  });
  it("does not swallow genuine replies, even ones that reuse a few of the tutor's words", () => {
    expect(isEcho("I am learning quadratic equations today", tutor)).toBe(false);
    expect(isEcho("how do I solve this", tutor)).toBe(false);
    expect(isEcho("is it two and three", tutor)).toBe(false);
  });
  it("ignores very short utterances and an empty history", () => {
    expect(isEcho("maths today", tutor)).toBe(false);
    expect(isEcho("What are you learning in maths today?", [])).toBe(false);
  });
});
