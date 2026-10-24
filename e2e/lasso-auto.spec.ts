import { expect, test } from "@playwright/test";
import { createNotebook } from "./helpers";

// Conversation-first: circling something is context for what you say next, not a trigger that makes the tutor talk.
test("circling with the lasso does not make the tutor reply on its own", async ({ page }) => {
  const asked: unknown[] = [];
  await page.route("**/api/ai/converse", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.abort();
  });
  await page.route("**/api/ai/chat", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.abort();
  });

  await createNotebook(page, "Lasso quiet");
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

  await expect(page.getByTestId("selection-region")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(asked).toHaveLength(0);
  await expect(page.getByTestId("ai-panel")).toHaveCount(0);
});
