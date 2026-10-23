import { describe, expect, it } from "vitest";
import { distanceToSegment, pointInPolygon, toNormalised, fromNormalised } from "./geometry";
import { applyChanges, hitsObject, inkStyleFor, invertChanges, makeInk, objectsInLasso, resizeBounds, strokePathData, transformObject } from "./ops";
import { notebookObjectSchema, saveObjectsSchema, type NotebookObject } from "./schemas";

const stroke = (pts: [number, number][]) => ({
  points: pts.map(([x, y]) => ({ x, y })),
  pressures: pts.map(() => 0.5),
  times: pts.map((_, i) => i * 10),
  hasPressure: false,
});
const pen = inkStyleFor("pen", "#111111", 3);

describe("makeInk", () => {
  it("stores points relative to the bbox origin and passes schema validation", () => {
    const ink = makeInk("ink_abcdefgh", stroke([[100, 200], [150, 250]]), pen, 1);
    expect(ink.x).toBeLessThan(100);
    expect(ink.data.points[0]! + ink.x).toBeCloseTo(100, 1);
    expect(ink.data.points[1]! + ink.y).toBeCloseTo(200, 1);
    expect(notebookObjectSchema.safeParse(ink).success).toBe(true);
    expect(ink.data.times).toHaveLength(ink.data.points.length / 2);
  });

  it("handles a single tap as a dot", () => {
    const ink = makeInk("ink_dotdotdot", stroke([[10, 10]]), pen, 1);
    expect(ink.data.points.length).toBe(4);
    expect(strokePathData(ink.data.points, undefined, pen)).toMatch(/^M/);
  });

  it("records pressure only when the device reported it", () => {
    const s = { ...stroke([[0, 0], [5, 5]]), hasPressure: true };
    expect(makeInk("ink_pressure1", s, pen, 1).data.pressures).toEqual([0.5, 0.5]);
    expect(makeInk("ink_nopressure", stroke([[0, 0], [5, 5]]), pen, 1).data.pressures).toBeUndefined();
  });
});

describe("history changes", () => {
  const a = makeInk("ink_aaaaaaaa", stroke([[0, 0], [10, 10]]), pen, 1);
  const b = makeInk("ink_bbbbbbbb", stroke([[20, 20], [30, 30]]), pen, 2);
  it("applies and inverts add / remove / update", () => {
    const moved: NotebookObject = { ...a, x: a.x + 5 };
    const changes = [
      { before: null, after: b },
      { before: a, after: moved },
    ];
    const next = applyChanges([a], changes);
    expect(next.map((o) => o.id)).toEqual(["ink_aaaaaaaa", "ink_bbbbbbbb"]);
    expect(next[0]!.x).toBe(moved.x);
    const back = applyChanges(next, invertChanges(changes));
    expect(back).toEqual([a]);
  });
});

describe("hit testing", () => {
  const line = makeInk("ink_lineeeee", stroke([[0, 0], [100, 0]]), pen, 1);
  it("hits ink near its centre line only", () => {
    expect(hitsObject(line, { x: 50, y: 2 }, 4)).toBe(true);
    expect(hitsObject(line, { x: 50, y: 30 }, 4)).toBe(false);
  });
  it("hits hollow shapes on the outline, not the interior", () => {
    const rect = notebookObjectSchema.parse({
      id: "shape_rect1", type: "SHAPE", x: 0, y: 0, width: 100, height: 100,
      data: { shape: "rect", stroke: "#000000", strokeWidth: 2, fill: null },
    });
    expect(hitsObject(rect, { x: 50, y: 50 }, 3)).toBe(false);
    expect(hitsObject(rect, { x: 1, y: 50 }, 3)).toBe(true);
  });
});

describe("lasso selection (imperfect circles)", () => {
  const circle = Array.from({ length: 24 }, (_, i) => ({
    x: 100 + 80 * Math.cos((i / 24) * Math.PI * 2) + (i % 3), // slightly wobbly
    y: 100 + 80 * Math.sin((i / 24) * Math.PI * 2),
  }));
  const inside = makeInk("ink_inside11", stroke([[80, 100], [120, 100]]), pen, 1);
  const outside = makeInk("ink_outside1", stroke([[400, 400], [450, 400]]), pen, 1);
  const straddling = makeInk("ink_straddle", stroke([[150, 100], [400, 100]]), pen, 1);
  it("selects objects mostly inside the polygon", () => {
    const ids = objectsInLasso([inside, outside, straddling], circle).map((o) => o.id);
    expect(ids).toContain("ink_inside11");
    expect(ids).not.toContain("ink_outside1");
    expect(ids).not.toContain("ink_straddle");
  });
  it("needs a real polygon", () => {
    expect(objectsInLasso([inside], [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });
});

describe("transform / resize", () => {
  it("scales ink points with the group box", () => {
    const ink = makeInk("ink_scale111", stroke([[0, 0], [100, 50]]), pen, 1);
    const from = { x: ink.x, y: ink.y, width: ink.width, height: ink.height };
    const out = transformObject(ink, from, { ...from, width: from.width * 2, height: from.height });
    expect(out.width).toBeCloseTo(ink.width * 2, 1);
    expect((out as typeof ink).data.points[2]).toBeCloseTo(ink.data.points[2]! * 2, 1);
  });
  it("enforces a minimum size and keeps aspect on corner handles", () => {
    const b = { x: 0, y: 0, width: 100, height: 50 };
    expect(resizeBounds(b, "se", { x: 5, y: 5 }, false).width).toBeGreaterThanOrEqual(12);
    const r = resizeBounds(b, "se", { x: 200, y: 60 }, true);
    expect(r.width / r.height).toBeCloseTo(2, 5);
  });
});

describe("geometry", () => {
  it("point-in-polygon and distance", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
  it("normalised coordinates round-trip", () => {
    const page = { width: 612, height: 792 };
    const r = { x: 61.2, y: 79.2, width: 306, height: 396 };
    const n = toNormalised(r, page);
    expect(n[0]).toBeCloseTo(0.1);
    const back = fromNormalised(n, page);
    expect(back.width).toBeCloseTo(r.width);
    expect(back.height).toBeCloseTo(r.height);
  });
});

describe("schema validation", () => {
  it("rejects malformed objects and oversized batches", () => {
    expect(notebookObjectSchema.safeParse({ id: "x", type: "INK" }).success).toBe(false);
    expect(
      notebookObjectSchema.safeParse({ id: "text_12345", type: "TEXT", x: 0, y: 0, width: 10, height: 10, data: { text: "hi", fontSize: 4, color: "red" } }).success,
    ).toBe(false);
    expect(saveObjectsSchema.safeParse({ upserts: [], deletes: Array(2001).fill("abcdefgh") }).success).toBe(false);
  });
  it("accepts a valid equation", () => {
    expect(
      notebookObjectSchema.safeParse({ id: "eq_12345678", type: "EQUATION", x: 0, y: 0, width: 50, height: 20, data: { latex: "x^2", fontSize: 24, color: "#000000" } }).success,
    ).toBe(true);
  });
});
