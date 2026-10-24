import { describe, expect, it } from "vitest";
import { isActiveExchange, isPhantomTranscript, looksMathy, quickControl, triageSchema } from "./converse";

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
  });
});
