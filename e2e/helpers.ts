import { expect, type Page } from "@playwright/test";

export async function createNotebook(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New notebook" }).first().click();
  await page.getByRole("textbox", { name: "Name" }).fill(title);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/notebooks\//);
  await expect(page.getByTestId("page-canvas")).toBeVisible();
  return page.url().split("/notebooks/")[1]!;
}

/** Draw a stroke with the mouse across the interaction layer (coordinates relative to the page box). */
export async function drawStroke(page: Page, from: [number, number], to: [number, number], steps = 12) {
  const box = (await page.getByTestId("interaction-layer").boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps });
  await page.mouse.up();
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 10_000 });
}

export const inkCount = async (page: Page) => Number(await page.getByTestId("page-canvas").getAttribute("data-ink-count"));
export const objectCount = async (page: Page) => Number(await page.getByTestId("page-canvas").getAttribute("data-object-count"));
