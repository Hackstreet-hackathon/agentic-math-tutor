import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { extractText, inspectPdf } from "../src/lib/server/pdf/analyze";
import { createNotebook, drawStroke, inkCount, waitSaved } from "./helpers";
import { makeLargePdf } from "./large-pdf";

const fx = (name: string) => path.resolve(__dirname, "fixtures", name);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function importFromLibrary(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("import-pdf-library-input").setInputFiles(fx(file));
}

async function openImported(page: Page, file: string) {
  await importFromLibrary(page, file);
  await page.waitForURL(/\/notebooks\//);
  await expect(page.getByTestId("pdf-background")).toHaveAttribute("data-pdf-state", "ready", { timeout: 20_000 });
  return page.url().split("/notebooks/")[1]!;
}

test.describe("PDF import and annotation", () => {
  test("imports a digital PDF, renders pages, and exposes a selectable text layer", async ({ page }) => {
    await openImported(page, "digital.pdf");
    await expect(page.getByTestId("notebook-title")).toHaveValue("digital");
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 3");
    await expect(page.getByTestId("pdf-text-layer")).toContainText("Problem 1. Solve x^2 + 5x + 6 = 0");

    // Page 2 is A4: navigation re-renders with the new page's own size.
    await page.getByLabel("Next page").click();
    await expect(page.getByTestId("page-indicator")).toHaveText("2 / 3");
    await expect(page.getByTestId("pdf-background")).toHaveAttribute("data-pdf-state", "ready", { timeout: 20_000 });
    await expect(page.getByTestId("pdf-text-layer")).toContainText("Chapter 2: Functions");

    // Text selection tool: only offered on PDF pages, and selecting really selects PDF text.
    await page.getByTestId("tool-textselect").click();
    await page.getByLabel("Previous page").click();
    await expect(page.getByTestId("pdf-text-layer")).toContainText("Problem 1");
    await page.getByTestId("tool-textselect").click();
    await page.getByTestId("pdf-text-layer").getByText(/Problem 1\./).click({ clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selected).toContain("Problem 1");
  });

  test("draws on top of the PDF, persists across reload, and never modifies the original", async ({ page }) => {
    const id = await openImported(page, "digital.pdf");
    const original = new Uint8Array(readFileSync(fx("digital.pdf")));

    await drawStroke(page, [150, 200], [450, 260]);
    await page.getByTestId("tool-text").click();
    await page.getByTestId("interaction-layer").click({ position: { x: 150, y: 420 } });
    await page.getByTestId("text-editor").fill("check this step");
    await page.getByTestId("tool-select").click();
    await waitSaved(page);

    await page.reload();
    await expect(page.getByTestId("pdf-background")).toHaveAttribute("data-pdf-state", "ready", { timeout: 20_000 });
    expect(await inkCount(page)).toBe(1);
    await expect(page.getByText("check this step")).toBeVisible();

    // The stored original is byte-identical to what was uploaded.
    const nb = await (await page.request.get(`/api/notebooks/${id}`)).json();
    const docId = nb.notebook.documents[0].id as string;
    const file = await page.request.get(`/api/documents/${docId}/file`);
    expect(file.headers()["content-type"]).toBe("application/pdf");
    expect(sha(new Uint8Array(await file.body()))).toBe(sha(original));
    // annotations are stored separately, attached to the PDF page
    const pdfPage = nb.notebook.pages[0];
    expect(pdfPage.pageType).toBe("PDF");
    expect(pdfPage.pdfPageNumber).toBe(1);
    expect(pdfPage.documentId).toBe(docId);
  });

  test("exports an annotated copy that keeps the original content", async ({ page }) => {
    await openImported(page, "digital.pdf");
    await drawStroke(page, [150, 200], [450, 260]);
    await page.getByTestId("tool-equation").click();
    await page.getByTestId("interaction-layer").click({ position: { x: 150, y: 400 } });
    await page.getByTestId("equation-input").fill("(x+2)(x+3)=0");
    await page.getByTestId("equation-input").press("Control+Enter");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-pdf").click()]);
    expect(download.suggestedFilename()).toBe("digital-annotated.pdf");
    const bytes = new Uint8Array(readFileSync((await download.path())!));
    const info = await inspectPdf(bytes);
    expect(info.pageCount).toBe(3);
    const text = await extractText(bytes);
    expect(text[0]!.text).toContain("Solve x^2 + 5x + 6 = 0");
    expect(text[1]!.text).toContain("Chapter 2: Functions");
  });

  test("scanned PDFs open and annotate, and are flagged as having no text layer", async ({ page }) => {
    await openImported(page, "scanned.pdf");
    await expect(page.getByTestId("document-notice")).toContainText(/Scanned page/, { timeout: 20_000 });
    await expect(page.getByTestId("pdf-text-layer")).toHaveText("");
    await drawStroke(page, [150, 200], [450, 260]);
    expect(await inkCount(page)).toBe(1);
    await waitSaved(page);
  });

  test("imports a PDF into an existing notebook after its own pages", async ({ page }) => {
    await createNotebook(page, `Mixed ${Date.now()}`);
    await page.getByTestId("import-pdf-input").setInputFiles(fx("digital.pdf"));
    await expect(page.getByTestId("page-indicator")).toHaveText("2 / 4", { timeout: 20_000 });
    await expect(page.getByTestId("pdf-background")).toHaveAttribute("data-pdf-state", "ready", { timeout: 20_000 });
    // the PDF-only tool exists on PDF pages and disappears on notebook pages
    await expect(page.getByTestId("tool-textselect")).toBeVisible();
    await page.getByTestId("page-thumb-1").click();
    await expect(page.getByTestId("tool-textselect")).toHaveCount(0);
  });

  test("rejects invalid uploads with clear messages and creates nothing", async ({ page }) => {
    await importFromLibrary(page, "not-a-pdf.pdf");
    await expect(page.getByTestId("import-error")).toContainText("Only PDF files can be imported");
    await page.getByLabel("Dismiss").click();
    await page.getByTestId("import-pdf-library-input").setInputFiles(fx("truncated.pdf"));
    await expect(page.getByTestId("import-error")).toContainText("not a valid or complete PDF");
    expect(page.url()).not.toContain("/notebooks/");
  });

  test("uploads larger than 10 MB arrive intact (no proxy body truncation)", async ({ page }) => {
    const big = await makeLargePdf(14);
    expect(big.byteLength).toBeGreaterThan(12 * 1024 * 1024);
    await page.goto("/");
    await page.getByTestId("import-pdf-library-input").setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.from(big) });
    await page.waitForURL(/\/notebooks\//, { timeout: 60_000 });
    const id = page.url().split("/notebooks/")[1]!;
    const nb = await (await page.request.get(`/api/notebooks/${id}`)).json();
    const res = await page.request.get(`/api/documents/${nb.notebook.documents[0].id}/file`);
    const body = new Uint8Array(await res.body());
    expect(body.byteLength).toBe(big.byteLength);
    expect(sha(body)).toBe(sha(big));
    await expect(page.getByTestId("pdf-background")).toHaveAttribute("data-pdf-state", "ready", { timeout: 30_000 });
  });

  test("another user cannot download someone else's PDF", async ({ page, browser }) => {
    const id = await openImported(page, "digital.pdf");
    const nb = await (await page.request.get(`/api/notebooks/${id}`)).json();
    const docId = nb.notebook.documents[0].id as string;
    const other = await browser.newContext();
    expect((await other.request.get(`/api/documents/${docId}/file`)).status()).toBe(404);
    expect((await other.request.get(`/api/documents/${docId}`)).status()).toBe(404);
    expect((await other.request.get(`/api/notebooks/${id}/export`)).status()).toBe(404);
    await other.close();
  });
});
