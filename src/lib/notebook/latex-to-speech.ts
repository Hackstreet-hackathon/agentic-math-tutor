/**
 * Convert LaTeX math expressions to natural English for text-to-speech.
 * Runs entirely client-side; no imports required.
 */
export function latexToSpeech(latex: string): string {
  let s = latex;

  // Matrices: read row by row, e.g. "the matrix with row 1: 1, 2; row 2: 3, 4". vmatrix is a determinant.
  s = s.replace(/\\begin\{(p|b|B|v|V)?matrix\}([\s\S]*?)\\end\{\1?matrix\}/g, (_m, kind: string | undefined, body: string) => {
    const rows = body
      .split(/\\\\/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r, i) => `row ${i + 1}: ${r.split("&").map((c) => c.trim()).join(", ")}`);
    return `${kind === "v" || kind === "V" ? "the determinant of the matrix" : "the matrix"} with ${rows.join("; ")}; `;
  });
  s = s.replace(/\\det\s*/g, "determinant of ");
  // A^T, A^{T}, A^{-1} (only after a capital letter or bracket, so x^{-1} keeps reading as a power)
  s = s.replace(/([A-Z)\]])\^\{?\\?(?:T|top)\}?/g, "$1 transpose");
  s = s.replace(/([A-Z)\]])\^\{-1\}/g, "$1 inverse");

  // Calculus: derivatives, integrals, limits.
  s = s.replace(/\\frac\{d\^?\{?2?\}?\s*([a-zA-Z]?)\}\{d\s*([a-zA-Z])\^?\{?2?\}?\}/g, (m, num: string, den: string) =>
    /\^\{?2/.test(m) ? `second derivative of ${num || "the function"} with respect to ${den}` : `derivative of ${num || "the function"} with respect to ${den}`,
  );
  s = s.replace(/\\partial\s*/g, "partial ");
  s = s.replace(/\\int_\{([^}]*)\}\^\{([^}]*)\}/g, "the integral from $1 to $2 of ");
  s = s.replace(/\\int(?![a-zA-Z])/g, "the integral of ");
  s = s.replace(/\\lim_\{([^}]*?)\s*\\(?:to|rightarrow)\s*([^}]*)\}/g, "the limit as $1 approaches $2 of ");
  s = s.replace(/\\(?:to|rightarrow)(?![a-zA-Z])/g, "approaches");
  s = s.replace(/\\cdot(?![a-zA-Z])/g, "times");
  s = s.replace(/([a-zA-Z])'+/g, "$1 prime");

  // Fractions: \frac{a}{b} → "a over b"
  s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1 over $2");

  // nth root: \sqrt[n]{x} → "nth root of x"
  s = s.replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, "$1th root of $2");

  // Square root: \sqrt{x} → "square root of x"
  s = s.replace(/\\sqrt\{([^}]*)\}/g, "square root of $1");

  // Exponent squared: x^{2} or x^2 — must come before general exponent rule
  s = s.replace(/\^\{2\}/g, " squared");
  s = s.replace(/\^2(?!\d)/g, " squared");

  // Exponent cubed: x^{3} or x^3 — must come before general exponent rule
  s = s.replace(/\^\{3\}/g, " cubed");
  s = s.replace(/\^3(?!\d)/g, " cubed");

  // General exponent: x^{n}
  s = s.replace(/\^\{([^}]*)\}/g, " to the power of $1");

  // Greek letters
  s = s.replace(/\\pi(?![a-zA-Z])/g, "pi");
  s = s.replace(/\\theta(?![a-zA-Z])/g, "theta");
  s = s.replace(/\\alpha(?![a-zA-Z])/g, "alpha");
  s = s.replace(/\\beta(?![a-zA-Z])/g, "beta");

  // Operators
  s = s.replace(/\\times(?![a-zA-Z])/g, "times");
  s = s.replace(/\\div(?![a-zA-Z])/g, "divided by");
  s = s.replace(/\\pm(?![a-zA-Z])/g, "plus or minus");

  // Comparisons
  s = s.replace(/\\leq(?![a-zA-Z])/g, "less than or equal to");
  s = s.replace(/\\geq(?![a-zA-Z])/g, "greater than or equal to");
  s = s.replace(/\\neq(?![a-zA-Z])/g, "not equal to");

  // Infinity
  s = s.replace(/\\infty(?![a-zA-Z])/g, "infinity");

  // Trig / log functions — remove backslash
  s = s.replace(/\\(sin|cos|tan|ln|log)(?![a-zA-Z])/g, "$1");

  // Remove remaining \command patterns
  s = s.replace(/\\[a-zA-Z]+/g, "");

  // Remove braces
  s = s.replace(/[{}]/g, "");

  // Remove dollar signs
  s = s.replace(/\$/g, "");

  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, " ").trim();

  return s;
}

/**
 * Convert an array of solution steps + final answer into a readable spoken paragraph.
 */
export function stepsToSpeech(
  steps: { latex: string | null; explanation: string }[],
  finalAnswer: string | null,
): string {
  const parts: string[] = [];

  steps.forEach((step, i) => {
    const pieces: string[] = [];
    if (step.explanation) pieces.push(step.explanation);
    if (step.latex) pieces.push(latexToSpeech(step.latex));
    if (pieces.length > 0) {
      parts.push(`Step ${i + 1}: ${pieces.join(". ")}`);
    }
  });

  if (finalAnswer) {
    parts.push(`The final answer is ${latexToSpeech(finalAnswer)}.`);
  }

  return parts.join(" ");
}
