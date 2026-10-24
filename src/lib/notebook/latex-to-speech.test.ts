import { describe, it, expect } from "vitest";
import { latexToSpeech, stepsToSpeech } from "./latex-to-speech";

describe("latexToSpeech", () => {
  it("converts fractions", () => {
    expect(latexToSpeech("\\frac{1}{2}")).toBe("1 over 2");
  });

  it("converts square root", () => {
    expect(latexToSpeech("\\sqrt{x}")).toBe("square root of x");
  });

  it("converts nth root", () => {
    expect(latexToSpeech("\\sqrt[3]{x}")).toBe("3th root of x");
  });

  it("converts x^2 to squared", () => {
    expect(latexToSpeech("x^2")).toBe("x squared");
  });

  it("converts x^{2} to squared", () => {
    expect(latexToSpeech("x^{2}")).toBe("x squared");
  });

  it("converts x^3 to cubed", () => {
    expect(latexToSpeech("x^3")).toBe("x cubed");
  });

  it("converts x^{3} to cubed", () => {
    expect(latexToSpeech("x^{3}")).toBe("x cubed");
  });

  it("converts general exponent x^{n}", () => {
    expect(latexToSpeech("x^{n}")).toBe("x to the power of n");
  });

  it("converts greek letters", () => {
    expect(latexToSpeech("\\pi")).toBe("pi");
    expect(latexToSpeech("\\theta")).toBe("theta");
    expect(latexToSpeech("\\alpha")).toBe("alpha");
    expect(latexToSpeech("\\beta")).toBe("beta");
  });

  it("converts operators", () => {
    expect(latexToSpeech("\\times")).toBe("times");
    expect(latexToSpeech("\\div")).toBe("divided by");
    expect(latexToSpeech("\\pm")).toBe("plus or minus");
  });

  it("converts comparison operators", () => {
    expect(latexToSpeech("\\leq")).toBe("less than or equal to");
    expect(latexToSpeech("\\geq")).toBe("greater than or equal to");
    expect(latexToSpeech("\\neq")).toBe("not equal to");
  });

  it("converts infinity", () => {
    expect(latexToSpeech("\\infty")).toBe("infinity");
  });

  it("removes backslash from trig/log functions", () => {
    expect(latexToSpeech("\\sin")).toBe("sin");
    expect(latexToSpeech("\\cos")).toBe("cos");
    expect(latexToSpeech("\\tan")).toBe("tan");
    expect(latexToSpeech("\\ln")).toBe("ln");
    expect(latexToSpeech("\\log")).toBe("log");
  });

  it("removes remaining \\commands", () => {
    expect(latexToSpeech("\\unknown{x}")).toBe("x");
  });

  it("removes braces and dollar signs", () => {
    expect(latexToSpeech("$x + {y}$")).toBe("x plus y");
  });

  it("collapses multiple spaces", () => {
    expect(latexToSpeech("a   b")).toBe("a b");
  });

  it("handles complex expression", () => {
    const result = latexToSpeech("\\frac{\\pi}{2}");
    expect(result).toBe("pi over 2");
  });

  it("handles sin with argument", () => {
    const result = latexToSpeech("\\sin(x)");
    expect(result).toBe("sin(x)");
  });
});

describe("stepsToSpeech", () => {
  it("formats steps and final answer", () => {
    const steps = [
      { latex: "x^2", explanation: "Square x" },
      { latex: "\\sqrt{y}", explanation: "Take root" },
    ];
    const result = stepsToSpeech(steps, "42");
    expect(result).toContain("Step 1:");
    expect(result).toContain("Step 2:");
    expect(result).toContain("The final answer is 42.");
  });

  it("returns empty string for empty steps and no answer", () => {
    expect(stepsToSpeech([], null)).toBe("");
  });

  it("handles only final answer", () => {
    const result = stepsToSpeech([], "x = 5");
    expect(result).toBe("The final answer is x equals 5.");
  });

  it("handles steps with no latex", () => {
    const result = stepsToSpeech([{ latex: "", explanation: "Start here" }], null);
    expect(result).toContain("Step 1: Start here");
  });
});

describe("calculus and matrices", () => {
  it("reads a 2x2 matrix row by row", () => {
    expect(latexToSpeech("\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}")).toBe("the matrix with row 1: 1, 2; row 2: 3, 4;");
  });

  it("reads a 3x3 determinant", () => {
    const t = latexToSpeech("\\begin{vmatrix}1&0&2\\\\0&1&3\\\\4&5&6\\end{vmatrix}");
    expect(t).toContain("the determinant of the matrix with row 1: 1, 0, 2; row 2: 0, 1, 3; row 3: 4, 5, 6");
  });

  it("reads transpose, inverse and det", () => {
    expect(latexToSpeech("A^T")).toBe("A transpose");
    expect(latexToSpeech("A^{-1}")).toBe("A inverse");
    expect(latexToSpeech("\\det(A)")).toBe("determinant of (A)");
    expect(latexToSpeech("x^{-1}")).toBe("x to the power of minus 1");
  });

  it("reads derivatives", () => {
    expect(latexToSpeech("\\frac{dy}{dx}")).toBe("derivative of y with respect to x");
    expect(latexToSpeech("\\frac{d}{dx}")).toBe("derivative of the function with respect to x");
    expect(latexToSpeech("f'(x)")).toBe("f prime(x)");
  });

  it("reads integrals and limits", () => {
    expect(latexToSpeech("\\int_{0}^{1} x^2 dx")).toBe("the integral from 0 to 1 of x squared dx");
    expect(latexToSpeech("\\int x dx + C")).toBe("the integral of x dx plus C");
    expect(latexToSpeech("\\lim_{x \\to 0} \\sin x")).toBe("the limit as x approaches 0 of sin x");
  });
});
