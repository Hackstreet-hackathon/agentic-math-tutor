import { describe, expect, it } from "vitest";
import { converseRequestSchema, hasMathTerms, looksLikeAnswer, isActiveExchange, isPhantomTranscript, looksMathy, quickControl, triageSchema } from "./converse";

describe("converse helpers", () => {
  it("detects control phrases without a model", () => {
    expect(quickControl("Stop.")).toBe("stop");
    expect(quickControl("never mind")).toBe("stop");
    expect(quickControl("Can you repeat that?")).toBeNull();
    expect(quickControl("repeat that")).toBe("repeat");
    expect(quickControl("stop listening")).toBe("stop_listening");
    expect(quickControl("stop the car, I mean factor x^2")).toBeNull();
  });

  it("drops Whisper's silence hallucinations", () => {
    for (const t of ["Thank you.", "you", "Thanks for watching!", " ", "Hmm...", "."]) expect(isPhantomTranscript(t)).toBe(true);
    expect(isPhantomTranscript("what rule do I use here")).toBe(false);
  });

  it("treats anything about a selection as maths, and plain chat as not", () => {
    expect(looksMathy("how do I solve this", true)).toBe(true);
    expect(looksMathy("what rule do I use here", true)).toBe(true);
    expect(looksMathy("what's your favourite colour", false)).toBe(false);
    expect(looksMathy("differentiate x squared", false)).toBe(true);
  });

  it("knows when a teaching exchange is active", () => {
    expect(isActiveExchange({ goal: "", stage: "check", attempts: 0 })).toBe(true);
    expect(isActiveExchange({ goal: "", stage: "idle", attempts: 0 })).toBe(false);
    expect(isActiveExchange(null)).toBe(false);
  });

  it("tolerates a bad triage reply", () => {
    expect(triageSchema.parse({ kind: "weird" }).kind).toBe("math");
    expect(triageSchema.parse({ kind: "smalltalk", control: null, ack: null }).kind).toBe("smalltalk");
    expect(triageSchema.parse({ kind: "offtopic", control: null, ack: null }).kind).toBe("offtopic");
  });

  it("tells answers apart from a change of subject mid-exercise", () => {
    for (const t of ["two and three", "yes", "I think it's x equals negative two", "is it five", "I don't know", "um"]) expect(looksLikeAnswer(t)).toBe(true);
    for (const t of ["Capital of France.", "what's the weather like today", "tell me a joke please"]) expect(looksLikeAnswer(t)).toBe(false);
  });

  it("allows the tutor's opening turn without a transcript, but not an empty student turn", () => {
    const base = { notebookId: "n1", pageId: "p1" };
    expect(converseRequestSchema.safeParse({ ...base, opening: true }).success).toBe(true);
    expect(converseRequestSchema.safeParse({ ...base, transcript: "hi" }).success).toBe(true);
    expect(converseRequestSchema.safeParse({ ...base }).success).toBe(false);
  });

  it("recognises maths vocabulary but not general chat", () => {
    for (const t of ["can you explain what a derivative is", "how do I factor this quadratic", "what is 3 + 4", "teach me about matrices"]) expect(hasMathTerms(t)).toBe(true);
    for (const t of ["tell me a joke about cats", "who won the football world cup", "write me a python function to sort a list", "how do you make pancakes"]) expect(hasMathTerms(t)).toBe(false);
  });
});
