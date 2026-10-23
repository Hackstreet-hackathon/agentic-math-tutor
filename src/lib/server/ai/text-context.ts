import { pointInPolygon, polygonCoverage, rectsIntersect, type Point, type Rect } from "@/lib/notebook/geometry";

/** PDF text item with a box normalised to 0..1 of the page (top-left origin). */
export interface TextItem {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageSize {
  width: number;
  height: number;
}

const toRect = (it: TextItem, p: PageSize): Rect => ({ x: it.x * p.width, y: it.y * p.height, width: it.w * p.width, height: it.h * p.height });

/** Items whose box is (mostly) inside the region. Imperfect circles are fine: coverage, not exact containment. */
export function itemsInRegion(items: TextItem[], region: { polygon?: Point[]; bounds: Rect }, page: PageSize, minCoverage = 0.4): TextItem[] {
  return items.filter((it) => {
    const r = toRect(it, page);
    if (!rectsIntersect(r, region.bounds)) return false;
    if (region.polygon && region.polygon.length >= 3) {
      const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      return pointInPolygon(centre, region.polygon) || polygonCoverage(region.polygon, r, 5) >= minCoverage;
    }
    const w = Math.min(r.x + r.width, region.bounds.x + region.bounds.width) - Math.max(r.x, region.bounds.x);
    const h = Math.min(r.y + r.height, region.bounds.y + region.bounds.height) - Math.max(r.y, region.bounds.y);
    const area = Math.max(1, r.width * r.height);
    return (Math.max(0, w) * Math.max(0, h)) / area >= minCoverage;
  });
}

/** Items in a horizontal band around the region (the surrounding problem statement, earlier lines, ...). */
export function itemsNearRegion(items: TextItem[], bounds: Rect, page: PageSize, marginAbove: number, marginBelow: number): TextItem[] {
  const band: Rect = { x: 0, y: bounds.y - marginAbove, width: page.width, height: bounds.height + marginAbove + marginBelow };
  return items.filter((it) => rectsIntersect(toRect(it, page), band));
}

/** Reading-order text from items: group into lines by vertical proximity, then left to right. */
export function itemsToText(items: TextItem[]): string {
  if (items.length === 0) return "";
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0]!.y - it.y) < Math.max(l[0]!.h, it.h) * 0.5);
    if (line) line.push(it);
    else lines.push([it]);
  }
  return lines
    .sort((a, b) => a[0]!.y - b[0]!.y)
    .map((l) =>
      l
        .sort((a, b) => a.x - b.x)
        .reduce((acc, it, i, arr) => {
          if (i === 0) return it.t;
          const prev = arr[i - 1]!;
          const gap = it.x - (prev.x + prev.w);
          return acc + (gap > prev.h * 0.15 && !acc.endsWith(" ") && !it.t.startsWith(" ") ? " " : "") + it.t;
        }, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/* ---------- lightweight lexical search over other pages ---------- */

const STOP = new Set("the a an and or of to in on for with is are was were be this that these those it its as at by from how what why when which who whom do does did can could would should i me my we you your they them their about into than then there here also not but if so".split(" "));

export const tokenize = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z0-9']{2,}/g) ?? []).filter((w) => !STOP.has(w));

export interface SearchDoc {
  /** Notebook page number (1-based) shown to the student. */
  page: number;
  source: "pdf" | "notebook";
  text: string;
}
export interface SearchHit {
  page: number;
  source: SearchDoc["source"];
  snippet: string;
  score: number;
}

/** TF-IDF-style ranking. Requires at least two distinct matching terms for multi-term queries to avoid noise. */
export function searchDocs(query: string, docs: SearchDoc[], limit = 2, snippetChars = 420): SearchHit[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || docs.length === 0) return [];
  const tokenised = docs.map((d) => tokenize(d.text));
  const df = new Map<string, number>();
  for (const toks of tokenised) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);

  const hits: SearchHit[] = [];
  docs.forEach((d, i) => {
    const counts = new Map<string, number>();
    for (const t of tokenised[i]!) counts.set(t, (counts.get(t) ?? 0) + 1);
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const c = counts.get(term);
      if (!c) continue;
      matched++;
      score += (1 + Math.log(c)) * Math.log(1 + docs.length / (df.get(term) ?? 1));
    }
    if (matched === 0 || (terms.length >= 3 && matched < 2)) return;
    hits.push({ page: d.page, source: d.source, snippet: snippetAround(d.text, terms, snippetChars), score });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippetAround(text: string, terms: string[], n: number): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, (at < 0 ? 0 : at) - Math.floor(n / 4));
  const s = text.slice(start, start + n).replace(/\s+/g, " ").trim();
  return (start > 0 ? "… " : "") + s + (start + n < text.length ? " …" : "");
}
