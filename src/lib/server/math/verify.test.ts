import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../env", () => ({ env: () => ({ MATH_SERVICE_URL: "" }) }));

import { autoVerify } from "./verify";

describe("autoVerify (no service configured)", () => {
  it("returns UNSUPPORTED when MATH_SERVICE_URL is not set", async () => {
    const result = await autoVerify({
      intent: "solve",
      question: "x^2 + 5x + 6 = 0",
      finalAnswer: "x=-2",
      steps: [],
    });
    expect(result.status).toBe("UNSUPPORTED");
  });

  it("returns UNSUPPORTED when no finalAnswer", async () => {
    const result = await autoVerify({
      intent: "solve",
      question: "x^2 + 5x + 6 = 0",
      finalAnswer: null,
      steps: [],
    });
    expect(result.status).toBe("UNSUPPORTED");
  });
});

describe("autoVerify (service unreachable)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns UNCERTAIN or UNSUPPORTED when the service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await autoVerify({
      intent: "solve",
      question: "x^2 + 5x + 6 = 0",
      finalAnswer: "x = -2",
      steps: [{ latex: "(x+2)(x+3)=0" }],
    });
    expect(["UNCERTAIN", "UNSUPPORTED"]).toContain(result.status);
  });
});
