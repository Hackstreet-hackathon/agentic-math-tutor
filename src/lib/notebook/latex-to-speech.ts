/**
 * Convert LaTeX math expressions to natural English for text-to-speech.
 * Runs entirely client-side; no imports required.
 */
export function latexToSpeech(latex: string): string {
  let s = latex;

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
