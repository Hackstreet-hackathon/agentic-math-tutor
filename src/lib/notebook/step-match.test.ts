import { describe, expect, it } from "vitest";
import { findStepObject, normMath } from "./step-match";
import type { NotebookObject } from "./schemas";

const eq = (id: string, latex: string, y: number): NotebookObject =>
  ({ id, type: "EQUATION", source: "USER", x: 100, y, width: 120, height: 30, rotation: 0, zIndex: 1, linkedToId: null, metadata: null, data: { latex, fontSize: 24, color: "#000000" } }) as NotebookObject;

describe("findStepObject", () => {
  const work = [eq("a", "x^2+5x+6=0", 120), eq("b", "(x+2)(x+4)=0", 240)];

  it("finds the flagged step by its text, whatever the checker thinks the y is", () => {
    expect(findStepObject(work, "(x + 2)(x + 4) = 0", 120)?.id).toBe("b");
    expect(findStepObject(work, "x^{2}+5x+6=0", 400)?.id).toBe("a");
  });
  it("ignores spacing and size commands", () => {
    expect(normMath("\\left( x+2 \\right)\\,=0")).toBe("(x+2)=0");
  });
  it("returns null when nothing matches, so the caller falls back to the position estimate", () => {
    expect(findStepObject(work, "y=3", 100)).toBeNull();
    expect(findStepObject(work, "x", 100)).toBeNull();
  });
  it("prefers the nearest of identical lines", () => {
    const twice = [eq("a", "x=2", 100), eq("b", "x=2", 300)];
    expect(findStepObject(twice, "x=2", 310)?.id).toBe("b");
  });
});
