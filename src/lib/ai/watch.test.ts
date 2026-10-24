import { describe, expect, it } from "vitest";
import { toWatchResponse } from "./watch";

const bounds = { y: 100, height: 200 };
const base = {
  problem: "Solve 2x+3=11",
  steps: [
    { latex: "2x+3=11", status: "ok", y: 0.2 },
    { latex: "2x=15", status: "wrong", y: 0.6 },
  ],
  firstWrongStep: 1,
  whatsWrong: "Subtracted 3 incorrectly.",
  nudge: "Check what you did to both sides.",
  voiceLine: "Hmm, that 15 looks suspicious.",
  confidence: "high",
};

describe("toWatchResponse", () => {
  it("flags the first wrong step and maps y onto the page", () => {
    const r = toWatchResponse(base, bounds);
    expect(r.status).toBe("flagged");
    expect(r.flag).toMatchObject({ stepIndex: 1, latex: "2x=15", y: 220 });
  });

  it("never flags on low confidence", () => {
    const r = toWatchResponse({ ...base, confidence: "low" }, bounds);
    expect(r.flag).toBeNull();
    expect(r.status).toBe("unsure");
  });

  it("does not flag when the step is only unclear", () => {
    const r = toWatchResponse({ ...base, steps: [base.steps[0], { latex: "?", status: "unclear", y: 0.6 }] }, bounds);
    expect(r.flag).toBeNull();
  });

  it("respects steps the student marked as not a mistake (whitespace-insensitive)", () => {
    const r = toWatchResponse(base, bounds, ["2x = 15"]);
    expect(r.flag).toBeNull();
  });

  it("requires a nudge to flag", () => {
    expect(toWatchResponse({ ...base, nudge: null }, bounds).flag).toBeNull();
  });

  it("reports ok when everything is right", () => {
    const r = toWatchResponse({ ...base, steps: [{ latex: "x=4", status: "ok", y: 0.5 }], firstWrongStep: null, nudge: null }, bounds);
    expect(r.status).toBe("ok");
  });

  it("degrades safely on garbage", () => {
    expect(toWatchResponse(null, bounds).status).toBe("unsure");
    expect(toWatchResponse({ steps: [] }, bounds).status).toBe("empty");
  });
});
