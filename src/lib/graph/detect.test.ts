import { describe, expect, it } from "vitest";
import { detectGraphable, latexToFn } from "./detect";

describe("latexToFn", () => {
  it("converts simple polynomial", () => {
    expect(latexToFn("x^2 - 4")).toBe("x^2-4");
  });

  it("converts trig functions", () => {
    const fn = latexToFn("\\sin(x)");
    expect(fn).toBe("sin(x)");
  });

  it("converts fraction", () => {
    const fn = latexToFn("\\frac{1}{x}");
    expect(fn).toContain("(1)/(x)");
  });

  it("inserts implicit multiplication", () => {
    const fn = latexToFn("2x + 3");
    expect(fn).toContain("2*x");
  });

  it("returns null when no x", () => {
    expect(latexToFn("5 + 3")).toBeNull();
  });

  it("returns null when no x in expression", () => {
    expect(latexToFn("\\unknown{5}")).toBeNull();
  });
});

describe("detectGraphable", () => {
  it("detects y = f(x) pattern", () => {
    const r = detectGraphable("y = x^2 - 4");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.fn).toBeTruthy();
    }
  });

  it("detects f(x) = ... pattern", () => {
    const r = detectGraphable("f(x) = 2x + 1");
    expect(r.kind).toBe("ok");
  });

  it("flags x^2 + 5x + 6 = 0 as unsupported (no y)", () => {
    const r = detectGraphable("x^2 + 5x + 6 = 0");
    expect(r.kind).toBe("unsupported");
  });

  it("flags implicit equations with y as ambiguous", () => {
    const r = detectGraphable("x^2 + y^2 = 1");
    expect(r.kind).toBe("ambiguous");
  });

  it("treats bare expression with x as y=expr", () => {
    const r = detectGraphable("x^3 - x");
    expect(r.kind).toBe("ok");
  });

  it("unsupported for plain constants", () => {
    const r = detectGraphable("\\pi");
    expect(r.kind).toBe("unsupported");
  });
});
