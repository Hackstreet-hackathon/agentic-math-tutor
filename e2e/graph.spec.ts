import { expect, test } from "@playwright/test";
import { createNotebook } from "./helpers";

// Graph panel works without AI; use the no-AI instance.
const APP_NO_AI = process.env.E2E_NOAI_URL ?? "http://127.0.0.1:3101";

test.describe("Graph panel", () => {
  test.use({ baseURL: APP_NO_AI });

  test("toggle opens and closes graph panel", async ({ page }) => {
    await createNotebook(page, `Graph toggle ${Date.now()}`);
    await page.getByTestId("toggle-graph").click();
    await expect(page.getByTestId("graph-panel")).toBeVisible();
    await page.getByTestId("toggle-graph").click();
    await expect(page.getByTestId("graph-panel")).toBeHidden();
  });

  test("graph panel shows no equations message when page is empty", async ({ page }) => {
    await createNotebook(page, `Graph empty ${Date.now()}`);
    await page.getByTestId("toggle-graph").click();
    await expect(page.getByTestId("graph-panel")).toBeVisible();
    await expect(page.getByTestId("graph-panel")).toContainText("No equations");
  });

  test("insert graph button is disabled when no equations are enabled", async ({ page }) => {
    await createNotebook(page, `Graph no-eq ${Date.now()}`);
    await page.getByTestId("toggle-graph").click();
    await expect(page.getByTestId("graph-panel")).toBeVisible();
    await expect(page.getByTestId("insert-graph")).toBeDisabled();
  });
});
