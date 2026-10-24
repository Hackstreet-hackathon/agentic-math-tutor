import type { NotebookObject } from "./schemas";

/** Comparable form of a maths line: no spaces, no spacing/size commands, no grouping braces, lower case. */
export function normMath(s: string): string {
  return s
    .toLowerCase()
    .replace(/\\(left|right|displaystyle|,|;|:|!|quad|qquad)/g, "")
    .replace(/[\s{}]/g, "");
}

const textOf = (o: NotebookObject): string | null => (o.type === "EQUATION" ? o.data.latex : o.type === "TEXT" ? o.data.text : null);

/**
 * The student's typed object that holds the flagged step, found by its text (the checker's position estimate is
 * only a guess for typed lines). When several match, the one nearest the estimated y wins.
 */
export function findStepObject(work: NotebookObject[], stepLatex: string, nearY: number): NotebookObject | null {
  const want = normMath(stepLatex);
  if (want.length < 2) return null;
  const hits = work.filter((o) => {
    const t = textOf(o);
    if (!t) return false;
    const have = normMath(t);
    return have === want || (have.length >= 4 && want.includes(have)) || (want.length >= 4 && have.includes(want));
  });
  if (hits.length === 0) return null;
  return hits.reduce((best, o) => (Math.abs(o.y + o.height / 2 - nearY) < Math.abs(best.y + best.height / 2 - nearY) ? o : best));
}
