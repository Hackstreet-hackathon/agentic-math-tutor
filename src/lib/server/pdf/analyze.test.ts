import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractText, inspectPdf, looksLikePdf, PdfError } from "./analyze";

const fixture = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../../../../e2e/fixtures", n)));

describe("inspectPdf", () => {
  it("reads page count, per-page sizes and metadata", async () => {
    const info = await inspectPdf(fixture("digital.pdf"));
    expect(info.pageCount).toBe(3);
    expect(info.pages[0]).toEqual({ width: 612, height: 792 });
    expect(info.pages[1]!.width).toBeCloseTo(595.28, 1); // A4 in the middle
    expect(info.metadata.title).toBe("Digital algebra worksheet");
  });

  it("rejects truncated files with a typed error", async () => {
    await expect(inspectPdf(fixture("truncated.pdf"))).rejects.toMatchObject({ kind: "invalid" });
    await expect(inspectPdf(fixture("not-a-pdf.pdf"))).rejects.toBeInstanceOf(PdfError);
  });
});

describe("extractText", () => {
  it("extracts digital text with normalised item boxes", async () => {
    const pages = await extractText(fixture("digital.pdf"));
    expect(pages).toHaveLength(3);
    expect(pages[0]!.source).toBe("pdf-text");
    expect(pages[0]!.text).toContain("Solve x^2 + 5x + 6 = 0");
    for (const it of pages[0]!.items) {
      expect(it.x).toBeGreaterThanOrEqual(0);
      expect(it.y).toBeGreaterThanOrEqual(0);
      expect(it.x + it.w).toBeLessThanOrEqual(1.01);
      expect(it.y + it.h).toBeLessThanOrEqual(1.01);
    }
    // Title is above the first problem (smaller y = nearer the top).
    const title = pages[0]!.items.find((i) => i.t.startsWith("Chapter"))!;
    const problem = pages[0]!.items.find((i) => i.t.startsWith("Problem 1"))!;
    expect(title.y).toBeLessThan(problem.y);
  });

  it("flags scanned pages instead of inventing text", async () => {
    const pages = await extractText(fixture("scanned.pdf"));
    expect(pages.map((p) => p.source)).toEqual(["none", "none"]);
    expect(pages.every((p) => p.text === "" && p.items.length === 0)).toBe(true);
  });
});

describe("looksLikePdf", () => {
  it("checks the header magic", () => {
    expect(looksLikePdf(fixture("digital.pdf"))).toBe(true);
    expect(looksLikePdf(fixture("not-a-pdf.pdf"))).toBe(false);
  });
});
