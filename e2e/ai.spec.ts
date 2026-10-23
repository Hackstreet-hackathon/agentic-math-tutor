import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { extractText } from "../src/lib/server/pdf/analyze";
import { createNotebook, drawStroke, objectCount, waitSaved } from "./helpers";

const FAKE = process.env.E2E_FAKE_LLM ?? "http://127.0.0.1:4010";
const NOAI = process.env.E2E_NOAI_URL ?? "http://localhost:3101";
const fx = (n: string) => path.resolve(__dirname, "fixtures", n);

type Recorded = { auth: string | null; body: { messages: { role: string; content: string | { type: string; text?: string }[] }[]; response_format?: { type: string } }; aborted: boolean };
const lastRequest = async (page: Page): Promise<Recorded> => (await page.request.get(`${FAKE}/__last`)).json();
const allRequests = async (page: Page): Promise<Recorded[]> => (await page.request.get(`${FAKE}/__requests`)).json();
const userText = (r: Recorded) => {
  const m = r.body.messages.filter((x) => x.role === "user").at(-1)!;
  return typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "[image]").join("\n");
};

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE}/__reset`);
});

async function openPdf(page: Page, file = "digital.pdf") {
  await page.goto("/");
  await page.getByTestId("import-pdf-library-input").setInputFiles(fx(file));
  await page.waitForURL(/\/notebooks\//);
  await expect(page.getByTestId("pdf-background")).toHaveAttribute("data-pdf-state", "ready", { timeout: 20_000 });
  return page.url().split("/notebooks/")[1]!;
}

/** Circle a region given in PAGE units (page 1 of the fixtures is 612pt wide). Deliberately wobbly, like a hand-drawn circle. */
async function lasso(page: Page, poly: [number, number][], pageWidth = 612) {
  await page.getByTestId("tool-lasso").click();
  const box = (await page.getByTestId("interaction-layer").boundingBox())!;
  const k = box.width / pageWidth;
  const at = ([x, y]: [number, number]) => [box.x + x * k, box.y + y * k] as const;
  await page.mouse.move(...at(poly[0]!));
  await page.mouse.down();
  for (const p of [...poly.slice(1), poly[0]!]) await page.mouse.move(...at(p), { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("selection-region")).toBeVisible();
}

// A rough circle around "Problem 1. Solve x^2 + 5x + 6 = 0 by factoring." on page 1 of digital.pdf.
const PROBLEM_1: [number, number][] = [[58, 124], [160, 114], [300, 112], [440, 118], [482, 132], [474, 156], [330, 170], [150, 168], [66, 160]];

test.describe("AI tutor (configured; provider is a local fake)", () => {
  test("circle a question -> Ask AI -> explanation with rendered maths; region text reaches the backend", async ({ page }) => {
    await openPdf(page);
    await lasso(page, PROBLEM_1);
    await page.getByTestId("ask-ai").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await expect(page.getByTestId("selection-indicator")).toContainText("Circled region");

    await page.getByTestId("action-solve").click();
    const answer = page.getByTestId("ai-answer").last();
    await expect(answer.locator(".katex").first()).toBeVisible({ timeout: 15_000 });
    await expect(answer).toContainText("AI-generated · not verified"); // never claims verification it did not do
    await expect(answer.getByTestId("final-answer")).toBeVisible();
    await expect(answer.locator("li")).toHaveCount(3);
    // maths is rendered, never shown as raw LaTeX source
    await expect(answer.locator(".katex-html").first()).not.toContainText("\\");
    await expect(page.getByTestId("context-used")).toContainText("selected text");

    // What the backend actually sent to the model:
    const req = await lastRequest(page);
    const text = userText(req);
    expect(text).toContain("<intent>solve</intent>");
    expect(text).toMatch(/<selected_text>\s*Problem 1\. Solve x\^2 \+ 5x \+ 6 = 0 by factoring\.\s*<\/selected_text>/);
    expect(text).not.toContain("Problem 2"); // only the circled part (+ nearby), not the whole document
    expect(text).not.toContain("Chapter 2");
    expect(req.body.response_format?.type).toBe("json_schema");
    expect(JSON.stringify(req.body.messages)).toContain("image_url"); // vision-capable model gets the region image
    expect(req.auth).toBe("Bearer sk-test-fake-key");
  });

  test("selecting PDF text and pressing Ask AI sends that text", async ({ page }) => {
    await openPdf(page);
    await page.getByTestId("tool-textselect").click();
    await page.getByTestId("pdf-text-layer").getByText(/Problem 2\./).click({ clickCount: 3 });
    await page.getByTestId("ask-ai-text").click();
    await expect(page.getByTestId("selection-indicator")).toContainText("Problem 2");
    await page.getByTestId("action-explain").click();
    await expect(page.getByTestId("ai-answer").last().getByText(/Context seen/)).toBeVisible({ timeout: 15_000 });
    const text = userText(await lastRequest(page));
    expect(text).toMatch(/<selected_text>[\s\S]*Problem 2\. Find the roots of 2x\^2 - 8 = 0\.[\s\S]*<\/selected_text>/);
    expect(text).toContain("<intent>explain</intent>");
  });

  test("hint and check-my-work intents produce hint / mistake presentations", async ({ page }) => {
    await openPdf(page);
    await lasso(page, PROBLEM_1);
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("action-hint").click();
    await expect(page.getByTestId("hint")).toContainText("two numbers that multiply");
    await page.getByTestId("action-check").click();
    await expect(page.getByTestId("mistake")).toContainText("Check step 1");
    await expect(page.getByTestId("mistake").locator(".katex").first()).toBeVisible();
  });

  test("write the solution on the page: free space, no overlap, undoable, exported, original untouched", async ({ page }) => {
    const id = await openPdf(page);
    await drawStroke(page, [120, 330], [330, 360]); // some student ink under the question
    await lasso(page, PROBLEM_1);
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("action-solve").click();
    await expect(page.getByTestId("insert-solution")).toBeVisible({ timeout: 15_000 });
    const before = await objectCount(page);
    await page.getByTestId("insert-solution").click();

    const card = page.getByTestId("ai-solution");
    await expect(card).toBeVisible();
    expect(await objectCount(page)).toBe(before + 1);
    await expect(card).toContainText("AI solution");
    await expect(card.locator(".katex").first()).toBeVisible();

    // Never covers printed text: every text-layer span is outside the card.
    const cardBox = (await card.boundingBox())!;
    const spans = await page.getByTestId("pdf-text-layer").locator("span").all();
    for (const s of spans) {
      const b = await s.boundingBox();
      if (!b || b.width < 2) continue;
      const overlap = b.x < cardBox.x + cardBox.width && b.x + b.width > cardBox.x && b.y < cardBox.y + cardBox.height && b.y + b.height > cardBox.y;
      expect(overlap, `text span at y=${Math.round(b.y)} overlaps the solution`).toBe(false);
    }

    // Undo removes it, redo brings it back.
    await page.keyboard.press("Control+z");
    expect(await objectCount(page)).toBe(before);
    await page.keyboard.press("Control+Shift+z");
    await expect(card).toBeVisible();
    await waitSaved(page);

    // Persisted as an AI-sourced object linked to the message; PDF original is byte-identical.
    await page.reload();
    await expect(page.getByTestId("ai-solution")).toBeVisible({ timeout: 15_000 });
    const nb = await (await page.request.get(`/api/notebooks/${id}`)).json();
    const sol = nb.notebook.pages[0].objects.find((o: { type: string }) => o.type === "AI_SOLUTION");
    expect(sol).toMatchObject({ source: "AI", data: { verificationStatus: "UNSUPPORTED" } });
    expect(sol.data.messageId).toBeTruthy();
    const docId = nb.notebook.documents[0].id as string;
    const file = new Uint8Array(await (await page.request.get(`/api/documents/${docId}/file`)).body());
    expect(createHash("sha256").update(file).digest("hex")).toBe(createHash("sha256").update(readFileSync(fx("digital.pdf"))).digest("hex"));

    // Exported PDF includes the AI card, clearly labelled.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-pdf").click()]);
    const pages = await extractText(new Uint8Array(readFileSync((await download.path())!)));
    expect(pages[0]!.text).toContain("AI SOLUTION");
    expect(pages[0]!.text).toContain("Solve x^2 + 5x + 6 = 0"); // original still there
  });

  test("a typed question works without any selection; actions need a selection; ambiguous asks get a clarification (no model call)", async ({ page }) => {
    await createNotebook(page, `Chat ${Date.now()}`);
    await page.getByTestId("toggle-ai").click();
    for (const a of ["explain", "solve", "check", "hint"]) await expect(page.getByTestId(`action-${a}`)).toBeDisabled();

    await page.getByTestId("ai-input").fill("check my work");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("clarification")).toContainText("Which part of the page");
    expect((await allRequests(page)).length).toBe(0); // deterministic: no LLM call spent

    await page.getByTestId("ai-input").fill("What is a quadratic equation?");
    await page.getByTestId("ai-input").press("Enter");
    await expect(page.getByTestId("ai-answer").last().getByText(/Context seen/)).toBeVisible({ timeout: 15_000 });
    expect((await allRequests(page)).length).toBe(1);
    expect(userText((await allRequests(page))[0]!)).toMatch(/<intent>(general|explain)<\/intent>/);
  });

  test("handwriting selection on a blank page: image + stroke count reach the model", async ({ page }) => {
    await createNotebook(page, `Ink ${Date.now()}`);
    await drawStroke(page, [150, 200], [330, 230]);
    await drawStroke(page, [150, 250], [330, 270]);
    await lasso(page, [[110, 150], [250, 140], [390, 160], [400, 290], [250, 310], [120, 290]], 816);
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("action-check").click();
    await expect(page.getByTestId("ai-answer").last().locator("[data-testid=mistake]")).toBeVisible({ timeout: 15_000 });
    const req = await lastRequest(page);
    expect(userText(req)).toMatch(/<handwriting strokes="2">[^<]*attached image/);
    expect(JSON.stringify(req.body.messages)).toContain("image_url");
  });

  test("prompt-injection text inside a PDF is passed only as untrusted data", async ({ page }) => {
    await openPdf(page);
    await page.getByLabel("Next page").click();
    await expect(page.getByTestId("pdf-text-layer")).toContainText("ignore previous instructions");
    await page.getByTestId("toggle-ai").click();
    await page.getByTestId("ai-input").fill("Summarize this page");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer").last().getByText(/injection present in document: yes/)).toBeVisible({ timeout: 15_000 });

    const text = userText(await lastRequest(page));
    const begin = text.indexOf("BEGIN_UNTRUSTED_CONTEXT");
    const end = text.indexOf("END_UNTRUSTED_CONTEXT");
    const inj = text.toLowerCase().indexOf("ignore previous instructions");
    expect(begin).toBeGreaterThan(-1);
    expect(inj).toBeGreaterThan(begin);
    expect(inj).toBeLessThan(end);
    expect(text.indexOf("<student_message>Summarize this page</student_message>")).toBeLessThan(begin);
  });

  test("provider failures are explained clearly and can be retried or cancelled", async ({ page }) => {
    await openPdf(page);
    await page.getByTestId("toggle-ai").click();
    const ask = async (msg: string) => {
      await page.getByTestId("ai-input").fill(msg);
      await page.getByTestId("ai-send").click();
    };

    await ask("What is a root? __AUTH__");
    await expect(page.getByTestId("ai-error").last()).toContainText("rejected the server’s API key");
    await expect(page.getByTestId("ai-error").last()).not.toContainText("sk-");

    await ask("What is a root? __RATE__");
    await expect(page.getByTestId("ai-error").last()).toContainText("rate-limiting");
    await expect(page.getByTestId("ai-error").last().getByRole("button", { name: /Try again/ })).toBeVisible();

    await ask("What is a root? __MALFORMED__");
    await expect(page.getByTestId("ai-answer").last()).toContainText("Unstructured reply");
    await expect(page.getByTestId("ai-answer").last()).toContainText("Sorry — here is some prose");
    await expect(page.getByTestId("ai-answer").last().locator(".katex").first()).toBeVisible(); // math in plain text still rendered

    await ask("What is a root? __TIMEOUT__");
    await expect(page.getByTestId("ai-error").last()).toContainText("took too long", { timeout: 15_000 }); // server timeout is 4s in this stack

    // Cancel mid-flight: the upstream request is aborted and no answer card is left behind.
    await page.request.post(`${FAKE}/__reset`);
    await ask("What is a root? __TIMEOUT__");
    await expect(page.getByTestId("ai-stop")).toBeVisible();
    await page.getByTestId("ai-stop").click();
    await expect(page.getByTestId("ai-stop")).toHaveCount(0);
    await expect.poll(async () => (await lastRequest(page))?.aborted, { timeout: 5_000 }).toBe(true);
  });

  test("conversation history survives a reload", async ({ page }) => {
    await createNotebook(page, `History ${Date.now()}`);
    await page.getByTestId("toggle-ai").click();
    await page.getByTestId("ai-input").fill("What is a polynomial?");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer").last().getByText(/Context seen/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page.getByTestId("toggle-ai").click();
    await expect(page.getByTestId("user-message").first()).toContainText("What is a polynomial?");
    await expect(page.getByTestId("ai-answer").first()).toContainText("Context seen");
  });

  test("API keys never reach the browser; other users cannot use or read someone else's notebook chat", async ({ page, browser }) => {
    const id = await openPdf(page);
    const nb = await (await page.request.get(`/api/notebooks/${id}`)).json();
    const pageId = nb.notebook.pages[0].id as string;

    for (const url of ["/api/ai/status", `/api/notebooks/${id}`, `/api/notebooks/${id}/conversation`]) {
      const body = await (await page.request.get(url)).text();
      expect(body).not.toMatch(/sk-test-fake-key|OPENAI_API_KEY|127\.0\.0\.1:4010/);
    }
    const html = await (await page.request.get(`/notebooks/${id}`)).text();
    expect(html).not.toContain("sk-test-fake-key");

    const other = await browser.newContext();
    const res = await other.request.post("/api/ai/chat", { data: { notebookId: id, pageId, message: "hi" } });
    expect(res.status()).toBe(404);
    expect((await other.request.get(`/api/notebooks/${id}/conversation`)).status()).toBe(404);
    await other.close();
  });

  test("payload validation rejects malformed AI requests", async ({ page }) => {
    const id = await openPdf(page);
    const nb = await (await page.request.get(`/api/notebooks/${id}`)).json();
    const pageId = nb.notebook.pages[0].id as string;
    const post = (data: unknown) => page.request.post("/api/ai/chat", { data });
    expect((await post({ notebookId: id, pageId, message: "" })).status()).toBe(400);
    expect((await post({ notebookId: id, pageId, message: "x".repeat(4001) })).status()).toBe(400);
    expect((await post({ notebookId: id, pageId, message: "hi", image: "data:text/html;base64,PHNjcmlwdD4=" })).status()).toBe(400);
    expect((await post({ notebookId: id, pageId, message: "hi", intent: "delete-everything" })).status()).toBe(400);
    expect((await post({ notebookId: id, pageId, message: "hi", selection: { region: { kind: "lasso", polygon: [1, 2], bounds: { x: 0, y: 0, width: 1, height: 1 } } } })).status()).toBe(400);
  });
});

test.describe("AI tutor not configured", () => {
  test.use({ baseURL: NOAI });

  test("the notebook stays fully usable and the panel explains why AI is unavailable", async ({ page }) => {
    await createNotebook(page, `NoAI ${Date.now()}`);
    await drawStroke(page, [120, 150], [320, 200]);
    await page.getByTestId("toggle-ai").click();
    await expect(page.getByTestId("ai-unavailable")).toContainText("isn’t set up");
    await expect(page.getByTestId("ai-input")).toBeDisabled();
    for (const a of ["explain", "solve", "check", "hint"]) await expect(page.getByTestId(`action-${a}`)).toBeDisabled();
    // everything else still works
    await waitSaved(page);
    expect(await objectCount(page)).toBe(1);
    const res = await page.request.post("/api/ai/chat", { data: { notebookId: "x", pageId: "y", message: "hi" } });
    expect([503, 404]).toContain(res.status());
  });
});
