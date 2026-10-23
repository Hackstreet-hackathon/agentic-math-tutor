import type { DetectResult } from "./types";

/**
 * Convert a LaTeX expression (right-hand side of y=...) to a function-plot compatible JS string.
 * Handles the most common high-school math patterns. Returns null if conversion fails.
 */
export function latexToFn(latex: string): string | null {
  let s = latex.trim();

  // Remove LaTeX display fences
  s = s.replace(/^\\\[|\\\]$|^\$\$|\$\$$|^\$|\$$/g, "").trim();

  // Fractions: \frac{a}{b} -> (a)/(b)
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");

  // Nested fracs (one level deep after first pass)
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");

  // sqrt: \sqrt{x} -> sqrt(x), \sqrt[n]{x} -> nthRoot(x,n)
  s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, "nthRoot($2,$1)");
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)");
  s = s.replace(/\\sqrt\s+([a-zA-Z0-9])/g, "sqrt($1)");

  // Trig and standard functions
  const fns = ["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "ln", "log", "exp", "abs", "sqrt"];
  for (const f of fns) {
    s = s.replace(new RegExp(`\\\\${f}(?!\\w)`, "g"), f);
  }
  // \log_base -> log(x)/log(base) — simplification: just treat as log
  s = s.replace(/\\log_\{?([^{}]+)\}?/g, "log");

  // Remove remaining backslash commands we don't know
  s = s.replace(/\\[a-zA-Z]+/g, "");

  // Curly braces used for grouping → parens
  s = s.replace(/\{/g, "(").replace(/\}/g, ")");

  // Exponent: x^2 is already valid; x^{2} was handled above
  // Implicit multiplication: 2x → 2*x, 2(x+1) → 2*(x+1), x(x+1) → x*(x+1)
  // Be careful not to insert * between a math function name and its opening paren.
  const mathFunctions = new Set(["sin","cos","tan","cot","sec","csc","arcsin","arccos","arctan","sinh","cosh","tanh","ln","log","exp","abs","sqrt","nthRoot"]);
  s = s.replace(/(\d)([a-zA-Z(])/g, "$1*$2");
  // Insert * before ( only when the preceding token is not a known function name.
  // Capture the full preceding word so "sin(" is recognized as a function call, not "n(".
  s = s.replace(/([a-zA-Z]+|\d|\))(\()/g, (_, pre, open) => {
    if (mathFunctions.has(pre)) return pre + open;
    return `${pre}*${open}`;
  });
  s = s.replace(/\)(\d)/g, ")*$1");
  s = s.replace(/\)([a-zA-Z])/g, ")*$1");

  // Minus sign: keep as-is (function-plot handles unary minus)
  // Remove spaces
  s = s.replace(/\s+/g, "");

  // Basic sanity: must contain 'x' to be a function of x
  if (!s.includes("x")) return null;

  // Reject if still has unknown LaTeX-like tokens
  if (/\\/.test(s)) return null;

  return s || null;
}

const Y_PATTERNS = [
  /^y\s*=\s*(.+)$/i,
  /^f\s*\(\s*x\s*\)\s*=\s*(.+)$/i,
  /^g\s*\(\s*x\s*\)\s*=\s*(.+)$/i,
  /^h\s*\(\s*x\s*\)\s*=\s*(.+)$/i,
];

/** Detect whether a LaTeX string is a graphable y=f(x) function. */
export function detectGraphable(latex: string): DetectResult {
  const s = latex.trim();

  for (const pat of Y_PATTERNS) {
    const m = pat.exec(s);
    if (m) {
      const rhs = m[1]!;
      const fn = latexToFn(rhs);
      if (fn) return { kind: "ok", fn, label: s };
      return { kind: "unsupported", reason: "The right-hand side contains expressions I cannot plot yet." };
    }
  }

  // Could be implicit (x^2+y^2=1) — flag as ambiguous
  if (/y/.test(s) && /=/.test(s)) {
    return { kind: "ambiguous", question: "This looks like an equation in x and y. Did you mean to graph it as y = f(x)?" };
  }

  // Pure expression with x but no y= — treat as y=expr
  if (/x/.test(s) && !/=/.test(s)) {
    const fn = latexToFn(s);
    if (fn) return { kind: "ok", fn, label: `y = ${s}` };
  }

  return { kind: "unsupported", reason: "Only y = f(x) functions can be graphed here." };
}
