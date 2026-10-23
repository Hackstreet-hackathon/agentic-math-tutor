import { readFileSync } from "node:fs";
import path from "node:path";
import { degrees, PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { inkStyleFor, makeInk } from "@/lib/notebook/ops";
import { notebookObjectSchema, type NotebookObject } from "@/lib/notebook/schemas";
import { extractText, inspectPdf } from "../pdf/analyze";
import { buildAnnotatedPdf, viewportToUser, type ExportPage } from "./pdf";

const fixture = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../../../../e2e/fixtures", n)));
const digital = fixture("digital.pdf");

const stroke = makeInk("ink_export01", { points: [{ x: 100, y: 100 }, { x: 200, y: 140 }, { x: 300, y: 100 }], pressures: [], times: [], hasPressure: false }, inkStyleFor("pen", "#dc2626", 4), 1);
const objs: NotebookObject[] = [
  stroke,
  notebookObjectSchema.parse({ id: "text_export1", type: "TEXT", x: 72, y: 300, width: 300, height: 30, data: { text: "My working: x = -2 ünïcödé ✓", fontSize: 16, color: "#1d4ed8" } }),
  notebookObjectSchema.parse({ id: "eq_export001", type: "EQUATION", x: 72, y: 360, width: 200, height: 40, data: { latex: "(x+2)(x+3)=0", fontSize: 28, color: "#15803d" } }),
  notebookObjectSchema.parse({ id: "eq_badlatex1", type: "EQUATION", x: 72, y: 420, width: 100, height: 40, data: { latex: "\\frac{", fontSize: 28, color: "#000000" } }),
  notebookObjectSchema.parse({ id: "shape_exp001", type: "SHAPE", x: 60, y: 90, width: 280, height: 70, data: { shape: "ellipse", stroke: "#ea580c", strokeWidth: 3, fill: null } }),
  notebookObjectSchema.parse({
    id: "ai_solution1", type: "AI_SOLUTION", source: "AI", x: 72, y: 560, width: 460, height: 150,
    data: { title: "Solution", steps: [{ latex: "x^2+5x+6=0", explanation: "Start with the equation, $a=1$." }, { latex: "(x+2)(x+3)=0", explanation: "Factor it." }], finalAnswer: "x=-2 \\text{ or } x=-3", verificationStatus: "UNSUPPORTED" },
  }),
  notebookObjectSchema.parse({ id: "shape_exp002", type: "SHAPE", x: 60, y: 500, width: 120, height: 40, data: { shape: "arrow", stroke: "#000000", strokeWidth: 2, fill: null } }),
];

describe("buildAnnotatedPdf", () => {
  it("copies original pages, keeps their text, and draws annotations on top", async () => {
    const pages: ExportPage[] = [
      { pageType: "PDF", width: 612, height: 792, source: { key: "doc", pdfPageNumber: 1 }, objects: objs },
      { pageType: "PDF", width: 595.28, height: 841.89, source: { key: "doc", pdfPageNumber: 2 }, objects: [] },
      { pageType: "GRID", width: 816, height: 1056, objects: [objs[0]!] },
    ];
    const before = Buffer.from(digital).toString("base64");
    const { bytes, skipped } = await buildAnnotatedPdf("Test", pages, async () => digital);

    expect(Buffer.from(digital).toString("base64")).toBe(before); // source bytes never mutated
    expect(skipped).toBe(1); // only the invalid LaTeX could not be drawn

    const info = await inspectPdf(bytes);
    expect(info.pageCount).toBe(3);
    expect(info.pages[0]).toEqual({ width: 612, height: 792 });
    expect(info.pages[1]!.width).toBeCloseTo(595.28, 1);
    expect(info.pages[2]).toEqual({ width: 612, height: 792 }); // notebook page -> Letter

    const text = await extractText(bytes);
    expect(text[0]!.text).toContain("Solve x^2 + 5x + 6 = 0"); // original content intact
    expect(text[0]!.text).toContain("My working: x = -2"); // annotation text is real text
    expect(text[0]!.text).toContain("?"); // unencodable glyphs degrade instead of crashing
    expect(text[0]!.text).toContain("AI SOLUTION"); // AI-written cards are exported, labelled as AI
    expect(text[0]!.text).toContain("Start with the equation, a=1.");
  });

  it("handles rotated source pages", async () => {
    const src = await PDFDocument.create();
    const pg = src.addPage([400, 600]);
    pg.setRotation(degrees(90));
    const srcBytes = await src.save();
    const { bytes } = await buildAnnotatedPdf("Rot", [{ pageType: "PDF", width: 600, height: 400, source: { key: "r", pdfPageNumber: 1 }, objects: [stroke] }], async () => srcBytes);
    const info = await inspectPdf(bytes);
    expect(info.pages[0]).toEqual({ width: 600, height: 400 }); // still displayed rotated
  });

  it("fails clearly when the source page is missing", async () => {
    await expect(
      buildAnnotatedPdf("x", [{ pageType: "PDF", width: 1, height: 1, source: { key: "doc", pdfPageNumber: 99 }, objects: [] }], async () => digital),
    ).rejects.toThrow("Page missing");
  });
});

describe("viewportToUser", () => {
  const g = { x0: 0, y0: 0, w: 400, h: 600, scale: 1 } as const;
  it("maps the displayed top-left corner correctly for every rotation", () => {
    // Unrotated: display top-left is user (0, h).
    expect(viewportToUser({ ...g, rotation: 0 }, 0, 0)).toEqual([0, 600]);
    // 90deg clockwise: the user's bottom-left (0,0) is displayed at the top-left.
    expect(viewportToUser({ ...g, rotation: 90 }, 0, 0)).toEqual([0, 0]);
    // 180deg: display top-left is the user's bottom-right.
    expect(viewportToUser({ ...g, rotation: 180 }, 0, 0)).toEqual([400, 0]);
    // 270deg: display top-left is the user's top-right.
    expect(viewportToUser({ ...g, rotation: 270 }, 0, 0)).toEqual([400, 600]);
  });
  it("is a rigid mapping (round-trips distances) and honours scale and crop origin", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const a = viewportToUser({ ...g, rotation, scale: 0.75, x0: 10, y0: 20 }, 100, 50);
      const b = viewportToUser({ ...g, rotation, scale: 0.75, x0: 10, y0: 20 }, 200, 50);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(75, 6);
    }
  });
});
