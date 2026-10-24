import { expect, test } from "@playwright/test";
import { createNotebook } from "./helpers";

const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

test("circling something with the lasso makes the tutor take the lead and ask about it, even with the panel closed", async ({ page }) => {
  const asked: { lasso?: boolean; transcript?: string; selection: { region: unknown; objectIds: string[] } | null }[] = [];
  await page.route("**/api/ai/converse", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: sse([
        ["meta", { conversationId: "c1", kind: "lasso", model: "gpt-4o" }],
        ["sentence", { text: "I see you circled the equation x squared plus five x plus six equals zero." }],
        ["sentence", { text: "What would you like to do with it?" }],
        ["state", { tutorState: { goal: "quadratic", stage: "check", attempts: 0 } }],
        ["done", { messageId: "m1", text: "x", latencyMs: 5 }],
      ]),
    });
  });

  await createNotebook(page, "Lasso");
  await expect(page.getByTestId("ai-panel")).toHaveCount(0); // panel closed

  await page.getByTestId("tool-equation").click();
  const il = (await page.getByTestId("interaction-layer").boundingBox())!;
  await page.mouse.click(il.x + 200, il.y + 180);
  await page.getByTestId("equation-input").fill("x^2+5x+6=0");
  await page.getByTestId("equation-input").press("Control+Enter");
  const eq = (await page.locator(".katex").first().boundingBox())!;

  await page.getByTestId("tool-lasso").click();
  const cx = eq.x + eq.width / 2, cy = eq.y + eq.height / 2, rx = eq.width / 2 + 25, ry = eq.height / 2 + 22;
  await page.mouse.move(cx + rx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();

  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(1);
  expect(asked[0]!.lasso).toBe(true);
  expect(asked[0]!.transcript).toBeUndefined();
  expect(asked[0]!.selection?.objectIds).toHaveLength(1);
  expect(asked[0]!.selection?.region).toBeTruthy();
  await expect(page.getByText("What would you like to do with it?")).toBeVisible();
});
