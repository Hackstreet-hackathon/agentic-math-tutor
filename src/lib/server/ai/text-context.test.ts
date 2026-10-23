import { describe, expect, it } from "vitest";
import { itemsInRegion, itemsNearRegion, itemsToText, searchDocs, tokenize, type TextItem } from "./text-context";

const page = { width: 600, height: 800 };
// Normalised items laid out like a worksheet page.
const item = (t: string, xPt: number, yPt: number, wPt: number, hPt = 14): TextItem => ({ t, x: xPt / 600, y: yPt / 800, w: wPt / 600, h: hPt / 800 });
const items: TextItem[] = [
  item("Chapter 1: Quadratic Equations", 72, 80, 280, 18),
  item("Problem 1. Solve", 72, 140, 100),
  item("x^2 + 5x + 6 = 0", 180, 140, 110),
  item("by factoring.", 296, 140, 80),
  item("Problem 2. Find the roots of 2x^2 - 8 = 0.", 72, 220, 300),
];

describe("itemsInRegion", () => {
  const polygonAround = (x: number, y: number, w: number, h: number) => [
    { x: x - 6, y: y - 10 }, { x: x + w / 2, y: y - 14 }, { x: x + w + 6, y: y - 8 }, { x: x + w + 10, y: y + h / 2 },
    { x: x + w + 4, y: y + h + 10 }, { x: x + w / 2, y: y + h + 14 }, { x: x - 8, y: y + h + 8 }, { x: x - 12, y: y + h / 2 },
  ];
  it("selects the items inside an imperfect circle and ignores the rest", () => {
    const poly = polygonAround(72, 140, 310, 14);
    const bounds = { x: 60, y: 126, width: 335, height: 40 };
    const got = itemsInRegion(items, { polygon: poly, bounds }, page).map((i) => i.t);
    expect(got).toEqual(["Problem 1. Solve", "x^2 + 5x + 6 = 0", "by factoring."]);
  });
  it("works with a plain rectangle too", () => {
    const got = itemsInRegion(items, { bounds: { x: 170, y: 130, width: 130, height: 30 } }, page).map((i) => i.t);
    expect(got).toEqual(["x^2 + 5x + 6 = 0"]);
  });
});

describe("itemsToText", () => {
  it("restores reading order and spaces on one line, newlines between lines", () => {
    const shuffled = [items[3]!, items[1]!, items[4]!, items[2]!];
    expect(itemsToText(shuffled)).toBe("Problem 1. Solve x^2 + 5x + 6 = 0 by factoring.\nProblem 2. Find the roots of 2x^2 - 8 = 0.");
  });
  it("handles empty input", () => expect(itemsToText([])).toBe(""));
});

describe("itemsNearRegion", () => {
  it("includes the surrounding lines within the vertical band only", () => {
    const near = itemsNearRegion(items, { x: 170, y: 140, width: 130, height: 14 }, page, 70, 20).map((i) => i.t);
    expect(near).toContain("Chapter 1: Quadratic Equations");
    expect(near).not.toContain("Problem 2. Find the roots of 2x^2 - 8 = 0.");
  });
});

describe("searchDocs", () => {
  const docs = [
    { page: 2, source: "pdf" as const, text: "The quadratic formula states that for ax^2 + bx + c = 0 the roots are x = (-b ± sqrt(discriminant)) / 2a. The discriminant b^2 - 4ac decides the number of roots." },
    { page: 3, source: "pdf" as const, text: "Chapter on trigonometry: sine, cosine and tangent of common angles." },
    { page: 4, source: "notebook" as const, text: "My notes: remember to check the discriminant first" },
  ];
  it("ranks the page that actually discusses the topic first, with a snippet", () => {
    const hits = searchDocs("what does the discriminant tell me about the quadratic roots", docs);
    expect(hits[0]!.page).toBe(2);
    expect(hits[0]!.snippet.toLowerCase()).toContain("discriminant");
    expect(hits.map((h) => h.page)).not.toContain(3);
  });
  it("returns nothing for unrelated queries instead of random pages", () => {
    expect(searchDocs("history of the roman empire", docs)).toEqual([]);
    expect(searchDocs("the a an", docs)).toEqual([]);
  });
  it("tokenises without stopwords", () => expect(tokenize("What is the Discriminant of x^2?")).toEqual(["discriminant"]));
});
