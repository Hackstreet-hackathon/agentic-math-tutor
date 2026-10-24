import { expect, test } from "@playwright/test";
import { createNotebook, drawStroke } from "./helpers";

const flagged = {
  status: "flagged",
  problem: "Solve 2x+3=11",
  stepCount: 2,
  flag: { stepIndex: 1, latex: "2x=15", y: 150, whatsWrong: "bad subtraction", nudge: "Re-check what 11 minus 3 is.", voiceLine: null },
  verified: false,
};

test("watch my work flags a wrong step, and can be dismissed for good", async ({ page }) => {
  const calls: unknown[] = [];
  await page.route("**/api/ai/watch", async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: flagged });
  });
  await createNotebook(page, "Watch");

  // Off by default: writing triggers nothing.
  await drawStroke(page, [100, 100], [260, 110]);
  await page.waitForTimeout(3500);
  expect(calls).toHaveLength(0);

  await page.getByTestId("watch-toggle").click();
  await expect(page.getByTestId("watch-flag")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("watch-state")).toHaveText("Check a step");
  expect(calls).toHaveLength(1);

  // The hint is revealed (and spoken) on demand; the underline covers the wrong line only, not the page.
  const tts: string[] = [];
  await page.route("**/api/ai/tts", async (route) => {
    tts.push(route.request().postDataJSON().text);
    await route.fulfill({ status: 503, json: { error: "off" } });
  });
  await expect(page.getByText("Re-check what 11 minus 3 is.")).toHaveCount(0);
  await page.getByTestId("watch-hint-btn").click();
  await expect(page.getByTestId("watch-hint")).toHaveText("Re-check what 11 minus 3 is.");
  await expect.poll(() => tts).toContain("Re-check what 11 minus 3 is.");
  const underline = await page.getByTestId("watch-underline").boundingBox();
  const pageBox = (await page.getByTestId("page-canvas").boundingBox())!;
  expect(underline!.width).toBeLessThan(pageBox.width / 2);

  // "Not a mistake" removes the flag and is remembered for the next check.
  await page.getByRole("button", { name: "Not a mistake" }).click();
  await expect(page.getByTestId("watch-flag")).toHaveCount(0);
  await drawStroke(page, [100, 140], [260, 150]);
  await expect.poll(() => calls.length, { timeout: 15_000 }).toBe(2);
  expect((calls[1] as { ignoredSteps: string[] }).ignoredSteps).toContain("2x=15");
});

test("a flagged step can be handed to the tutor with 'Show me'", async ({ page }) => {
  await page.route("**/api/ai/watch", (route) => route.fulfill({ json: flagged }));
  await createNotebook(page, "Watch 2");
  await drawStroke(page, [100, 100], [260, 110]);
  await page.getByTestId("watch-toggle").click();
  await expect(page.getByTestId("watch-flag")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("watch-flag")).toHaveCount(0);
});

test("the tutor praises the student once the flagged step is fixed", async ({ page }) => {
  let n = 0;
  await page.route("**/api/ai/watch", (route) =>
    route.fulfill({ json: n++ === 0 ? flagged : { status: "ok", problem: "Solve 2x+3=11", stepCount: 2, flag: null, verified: false } }),
  );
  const tts: string[] = [];
  await page.route("**/api/ai/tts", async (route) => {
    tts.push(route.request().postDataJSON().text);
    await route.fulfill({ status: 503, json: { error: "off" } });
  });
  await createNotebook(page, "Praise");
  await drawStroke(page, [100, 100], [260, 110]);
  await page.getByTestId("watch-toggle").click();
  await expect(page.getByTestId("watch-flag")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "I’ll fix it" }).click();
  await drawStroke(page, [100, 140], [260, 150]); // the student rewrites the step
  await expect.poll(() => tts.length, { timeout: 20_000 }).toBe(1);
  expect(tts[0]).toMatch(/fixed|corrected|right|Nice|Brilliant|Yes|job|work|Well/i);
});
