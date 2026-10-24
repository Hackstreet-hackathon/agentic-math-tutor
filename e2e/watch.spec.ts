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
  await expect(page.getByText("Re-check what 11 minus 3 is.")).toBeVisible();
  expect(calls).toHaveLength(1);

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
