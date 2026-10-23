import { describe, expect, it } from "vitest";
import { findFreeSpot, estimateSolutionHeight, occupancyRects } from "./placement";

const page = { width: 612, height: 792 };
const size = { width: 520, height: 160 };

describe("findFreeSpot", () => {
  it("places the answer directly below the question when space is free", () => {
    const anchor = { x: 72, y: 130, width: 400, height: 40 };
    const r = findFreeSpot({ page, obstacles: [anchor], anchor, size });
    expect(r.kind).toBe("free");
    if (r.kind === "free") {
      // a 520pt card on a 612pt page can only start between the margins (36..56)
      expect(r.x).toBeGreaterThanOrEqual(36);
      expect(r.x).toBeLessThanOrEqual(56);
      expect(r.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    }
  });

  it("never overlaps existing work: skips past it", () => {
    const anchor = { x: 72, y: 130, width: 400, height: 40 };
    const studentWork = { x: 72, y: 180, width: 300, height: 200 }; // handwriting right under the question
    const r = findFreeSpot({ page, obstacles: [anchor, studentWork], anchor, size });
    expect(r.kind).toBe("free");
    if (r.kind === "free") {
      const placed = { x: r.x, y: r.y, ...size };
      const clash = [anchor, studentWork].some((o) => placed.x < o.x + o.width && placed.x + placed.width > o.x && placed.y < o.y + o.height && placed.y + placed.height > o.y);
      expect(clash).toBe(false);
      expect(r.y).toBeGreaterThanOrEqual(studentWork.y + studentWork.height);
    }
  });

  it("stays inside the page margins", () => {
    const r = findFreeSpot({ page, obstacles: [], anchor: { x: 500, y: 700, width: 50, height: 20 }, size });
    expect(r.kind).toBe("free");
    if (r.kind === "free") {
      expect(r.x + size.width).toBeLessThanOrEqual(page.width - 36);
      expect(r.y + size.height).toBeLessThanOrEqual(page.height - 36);
    }
  });

  it("reports no space instead of overlapping when the page is full", () => {
    const wall = { x: 0, y: 0, width: 612, height: 792 };
    expect(findFreeSpot({ page, obstacles: [wall], anchor: null, size })).toEqual({ kind: "no-space" });
  });

  it("reports no space when the solution is larger than the page", () => {
    expect(findFreeSpot({ page, obstacles: [], anchor: null, size: { width: 520, height: 900 } })).toEqual({ kind: "no-space" });
  });

  it("can use the space above the question when below is full", () => {
    const anchor = { x: 72, y: 600, width: 400, height: 40 };
    const below = { x: 0, y: 650, width: 612, height: 142 };
    const r = findFreeSpot({ page, obstacles: [anchor, below], anchor, size });
    expect(r.kind).toBe("free");
    if (r.kind === "free") expect(r.y + size.height).toBeLessThanOrEqual(anchor.y);
  });
});

describe("estimateSolutionHeight", () => {
  it("grows with steps and wrapped explanation text", () => {
    const short = estimateSolutionHeight({ steps: [{ latex: "x=1", explanation: "ok" }] }, 520);
    const long = estimateSolutionHeight({ steps: [{ latex: "x=1", explanation: "word ".repeat(120) }, { latex: "y", explanation: "b" }], finalAnswer: "x" }, 520);
    expect(long).toBeGreaterThan(short + 60);
  });
});

describe("occupancyRects", () => {
  it("finds drawn content from pixels and merges runs", () => {
    const cols = 6;
    const rows = 4;
    const px = new Uint8ClampedArray(cols * rows * 4).fill(255);
    const dark = (c: number, r: number) => {
      const i = (r * cols + c) * 4;
      px[i] = px[i + 1] = px[i + 2] = 20;
    };
    dark(1, 1); dark(2, 1); dark(1, 2); dark(2, 2); // a 2x2 block of ink
    const rects = occupancyRects(px, cols, rows, 8);
    expect(rects).toEqual([{ x: 8, y: 8, width: 16, height: 16 }]);
  });
  it("treats transparent pixels as white", () => {
    const px = new Uint8ClampedArray(4 * 4).fill(0); // fully transparent
    expect(occupancyRects(px, 2, 2, 8)).toEqual([]);
  });
});
