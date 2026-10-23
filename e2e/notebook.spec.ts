import { expect, test } from "@playwright/test";
import { createNotebook, drawStroke, inkCount, objectCount, waitSaved } from "./helpers";

test.describe("notebook library", () => {
  test("create, search, rename and delete a notebook", async ({ page }) => {
    const name = `Calculus ${Date.now()}`;
    await createNotebook(page, name);
    await page.goto("/");
    await expect(page.getByText(name)).toBeVisible();

    await page.getByLabel("Search notebooks").fill("zzz-no-match");
    await expect(page.getByText("No notebooks match your search")).toBeVisible();
    await page.getByLabel("Search notebooks").fill(name);
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole("button", { name: `Options for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(`${name} II`);
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByText(`${name} II`)).toBeVisible();

    await page.getByRole("button", { name: `Options for ${name} II` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("will be permanently deleted")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(`${name} II`)).toHaveCount(0);
  });

  test("organises notebooks into subjects", async ({ page }) => {
    const subject = `Physics ${Date.now()}`;
    const nb = `Kinematics ${Date.now()}`;
    await createNotebook(page, nb);
    await page.goto("/");
    await page.getByRole("button", { name: "New subject" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(subject);
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("button", { name: `Options for ${nb}` }).click();
    await page.getByRole("menuitem", { name: subject }).click();
    await page.getByRole("button", { name: new RegExp(subject) }).first().click();
    await expect(page.getByText(nb)).toBeVisible();
  });
});

test.describe("notebook workspace", () => {
  test("draw, autosave, reload, undo/redo, erase", async ({ page }) => {
    await createNotebook(page, `Drawing ${Date.now()}`);
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/);

    await drawStroke(page, [120, 150], [420, 220]);
    await drawStroke(page, [120, 260], [420, 330]);
    expect(await inkCount(page)).toBe(2);
    await waitSaved(page);

    // Reload: strokes persist (undo history is per-session by design).
    await page.reload();
    await expect(page.getByTestId("page-canvas")).toBeVisible();
    expect(await inkCount(page)).toBe(2);

    await drawStroke(page, [120, 400], [420, 470]);
    expect(await inkCount(page)).toBe(3);
    await page.keyboard.press("Control+z");
    expect(await inkCount(page)).toBe(2);
    await page.keyboard.press("Control+Shift+z");
    expect(await inkCount(page)).toBe(3);
    await page.keyboard.press("Control+z");
    expect(await inkCount(page)).toBe(2);
    await waitSaved(page);

    // Eraser removes a whole stroke it crosses; undo brings it back.
    await page.getByTestId("tool-eraser").click();
    await drawStroke(page, [270, 120], [270, 240], 20);
    expect(await inkCount(page)).toBe(1);
    await page.keyboard.press("Control+z");
    expect(await inkCount(page)).toBe(2);
    await waitSaved(page);

    await page.reload();
    expect(await inkCount(page)).toBe(2);
  });

  test("select, move and delete with the selection tool", async ({ page }) => {
    await createNotebook(page, `Select ${Date.now()}`);
    await drawStroke(page, [150, 150], [350, 150]);
    await page.getByTestId("tool-select").click();
    await drawStroke(page, [250, 150], [250, 150], 1); // click on the stroke
    await expect(page.getByLabel("Delete selection")).toBeVisible();
    await page.getByLabel("Delete selection").click();
    expect(await inkCount(page)).toBe(0);
    await page.keyboard.press("Control+z");
    expect(await inkCount(page)).toBe(1);
  });

  test("text and equation objects render and persist", async ({ page }) => {
    await createNotebook(page, `Text ${Date.now()}`);

    await page.getByTestId("tool-text").click();
    await page.getByTestId("interaction-layer").click({ position: { x: 150, y: 120 } });
    await page.getByTestId("text-editor").fill("Solve the quadratic");
    await page.getByTestId("tool-select").click(); // blur commits
    await expect(page.getByText("Solve the quadratic")).toBeVisible();

    await page.getByTestId("tool-equation").click();
    await page.getByTestId("interaction-layer").click({ position: { x: 150, y: 260 } });
    await page.getByTestId("equation-input").fill("x^2+5x+6=0");
    await expect(page.getByTestId("equation-preview").locator(".katex")).toBeVisible();
    await page.getByTestId("equation-input").press("Control+Enter");
    await expect(page.getByTestId("page-canvas").locator(".katex")).toBeVisible();
    expect(await objectCount(page)).toBe(2);
    await waitSaved(page);

    await page.reload();
    await expect(page.getByText("Solve the quadratic")).toBeVisible();
    await expect(page.getByTestId("page-canvas").locator(".katex")).toBeVisible();

    // Edit the equation by double-clicking it with the select tool.
    await page.getByTestId("tool-select").click();
    const eq = await page.getByTestId("page-canvas").locator(".katex").boundingBox();
    await page.mouse.dblclick(eq!.x + 10, eq!.y + 10);
    await page.getByTestId("equation-input").fill("x^2=4");
    await page.getByTestId("equation-input").press("Control+Enter");
    await expect(page.getByTestId("page-canvas").locator(".katex-mathml annotation")).toHaveText("x^2=4");
  });

  test("page management: add, switch, reorder, change background, delete", async ({ page }) => {
    await createNotebook(page, `Pages ${Date.now()}`);
    await drawStroke(page, [100, 100], [300, 100]);
    await waitSaved(page);

    await page.getByTestId("add-page").click();
    await expect(page.getByTestId("page-indicator")).toHaveText("2 / 2");
    expect(await inkCount(page)).toBe(0);

    await page.getByTestId("page-thumb-1").click();
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 2");
    expect(await inkCount(page)).toBe(1);

    // Move page 1 down: the drawn page becomes page 2.
    await page.getByRole("button", { name: "Options for page 1" }).click();
    const reordered = page.waitForResponse((r) => r.url().includes("/api/pages/") && r.request().method() === "PATCH");
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await reordered;
    await page.getByTestId("page-thumb-2").click();
    await expect(page.getByTestId("page-indicator")).toHaveText("2 / 2");
    expect(await inkCount(page)).toBe(1);

    await page.getByRole("button", { name: "Options for page 2" }).click();
    await page.getByRole("menuitem", { name: "Grid" }).click();
    await expect(page.getByTestId("page-canvas")).toHaveClass(/page-grid/);

    await page.reload();
    await page.getByTestId("page-thumb-2").click();
    expect(await inkCount(page)).toBe(1);
    await expect(page.getByTestId("page-canvas")).toHaveClass(/page-grid/);

    await page.getByRole("button", { name: "Options for page 2" }).click();
    await page.getByRole("menuitem", { name: "Delete page" }).click();
    await page.getByRole("button", { name: "Delete page" }).click();
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 1");
  });

  test("lasso selects an imperfect circle around ink and ignores outside ink", async ({ page }) => {
    await createNotebook(page, `Lasso ${Date.now()}`);
    await drawStroke(page, [200, 200], [260, 205]); // inside
    await drawStroke(page, [500, 500], [560, 505]); // outside
    await page.getByTestId("tool-lasso").click();
    const box = (await page.getByTestId("interaction-layer").boundingBox())!;
    const cx = box.x + 230, cy = box.y + 203;
    await page.mouse.move(cx + 90, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      await page.mouse.move(cx + 90 * Math.cos(a) + (i % 3) * 2, cy + 70 * Math.sin(a));
    }
    await page.mouse.up();
    await expect(page.getByTestId("selection-region")).toBeVisible();
    await page.getByLabel("Duplicate selection").click(); // duplicates only the selected stroke
    expect(await inkCount(page)).toBe(3);
  });
});

test.describe("access control", () => {
  test("another browser profile cannot open a private notebook", async ({ page, browser }) => {
    const id = await createNotebook(page, `Private ${Date.now()}`);
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(`/notebooks/${id}`);
    await expect(p2.getByText("Notebook not found")).toBeVisible();
    const res = await p2.request.get(`/api/notebooks/${id}`);
    expect(res.status()).toBe(404);
    await other.close();
  });

  test("API never exposes secrets", async ({ request }) => {
    const res = await request.get("/api/notebooks");
    const text = await res.text();
    expect(text).not.toMatch(/sk-|SESSION_SECRET|DATABASE_URL/);
  });
});

test.describe("guest identity", () => {
  test("a fresh browser gets one stable identity before any API call, even with parallel first requests", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    const cookie = async () => (await ctx.cookies()).find((c) => c.name === "mn_session")?.value;
    const first = await cookie();
    expect(first, "proxy should mint the session cookie on the first page request").toBeTruthy();

    // Hammer the API in parallel, then create data: nothing may change the identity or orphan the data.
    const results = await page.evaluate(async () => {
      const calls = Array.from({ length: 8 }, () => fetch("/api/notebooks").then((r) => r.status));
      calls.push(fetch("/api/folders").then((r) => r.status));
      calls.push(fetch("/api/notebooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Race" }) }).then((r) => r.status));
      return Promise.all(calls);
    });
    expect(results.every((s) => s === 200 || s === 201)).toBe(true);
    expect(await cookie()).toBe(first);
    const list = await (await page.request.get("/api/notebooks")).json();
    expect(list.notebooks.map((n: { title: string }) => n.title)).toContain("Race");
    await ctx.close();
  });

  test("the identity cookie is HttpOnly and not readable from page scripts", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => document.cookie)).not.toContain("mn_session");
    const c = (await page.context().cookies()).find((x) => x.name === "mn_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
  });
});
