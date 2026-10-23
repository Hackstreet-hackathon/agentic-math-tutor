import { describe, expect, it } from "vitest";
import { latexToVector } from "./math-vector";

describe("latexToVector", () => {
  it("produces glyph outlines inside a sane content box", () => {
    const v = latexToVector("x^2+5x+6=0")!;
    expect(v).not.toBeNull();
    expect(v.paths.length).toBeGreaterThan(5);
    expect(v.width).toBeGreaterThan(1000);
    // every point lies (approximately) within the viewBox
    const pad = 50;
    for (const path of v.paths) {
      for (const c of path) {
        for (let i = 1; i + 1 < c.length; i += 2) {
          const x = c[i] as number;
          const y = c[i + 1] as number;
          expect(x).toBeGreaterThanOrEqual(v.minX - pad);
          expect(x).toBeLessThanOrEqual(v.minX + v.width + pad);
          expect(y).toBeGreaterThanOrEqual(v.minY - pad);
          expect(y).toBeLessThanOrEqual(v.minY + v.height + pad);
        }
      }
    }
  });

  it("draws fraction bars (rect) and nested transforms", () => {
    const v = latexToVector("\\frac{a}{b}")!;
    expect(v.paths.some((p) => p.length === 5 && p[0]![0] === "M" && p[4]![0] === "Z")).toBe(true);
  });

  it("returns null for invalid LaTeX instead of throwing", () => {
    expect(latexToVector("\\frac{")).toBeNull();
    expect(latexToVector("\\undefinedmacro{x}")).toBeNull();
  });

  it("does not execute or fetch anything from hostile input", () => {
    expect(() => latexToVector("\\href{javascript:alert(1)}{x}")).not.toThrow();
    expect(() => latexToVector("\\require{html}\\unicode{x}")).not.toThrow();
  });
});
