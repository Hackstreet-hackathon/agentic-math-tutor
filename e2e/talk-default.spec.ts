import path from "node:path";
import { expect, test } from "@playwright/test";
import { createNotebook } from "./helpers";

// Fresh browser profile: no saved preferences, so the defaults apply. A fake microphone lets getUserMedia succeed.
test.use({
  storageState: { cookies: [], origins: [] },
  permissions: ["microphone"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${path.resolve(__dirname, "fixtures", "silence.wav")}%noloop`],
  },
});

const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

test("the tutor is open and talking as soon as a notebook opens, and every line lands in the panel", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/ai/converse", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: body.opening
        ? sse([["meta", { conversationId: "c1", kind: "opening", model: "m" }], ["sentence", { text: "Hi! What are you learning today?" }], ["done", { messageId: "m0", text: "x", latencyMs: 1 }]])
        : sse([
            ["meta", { conversationId: "c1", kind: "math", model: "m" }],
            ["ack", { text: "Good question, let me look at that." }],
            ["sentence", { text: "Try factoring it." }],
            ["done", { messageId: "m1", text: "x", latencyMs: 1 }],
          ]),
    });
  });
  await page.route("**/api/ai/tts", (route) => route.fulfill({ status: 503, json: { error: "off" } }));

  await createNotebook(page, "Auto talk");
  // Nothing was clicked: the panel is open, Talk is on, and the tutor has already spoken first.
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("convo-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Hi! What are you learning today?")).toBeVisible({ timeout: 10_000 });
  expect(requests[0]).toMatchObject({ opening: true });

  // The spoken acknowledgement is part of the visible conversation too.
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 15_000 });
  await page.getByTestId("convo-say").fill("how do I solve this");
  await page.getByTestId("convo-say").press("Enter");
  await expect(page.getByText(/Good question, let me look at that\. Try factoring it\./)).toBeVisible({ timeout: 10_000 });

  // Turning Talk off is remembered across a reload.
  await page.getByTestId("convo-toggle").click();
  await page.reload();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("convo-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("without a click the browser would block sound, so the tutor asks for a tap first and then starts", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/ai/converse", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sse([["meta", { conversationId: "c1", kind: "opening", model: "m" }], ["sentence", { text: "Hi! What are you learning today?" }], ["done", { messageId: "m0", text: "x", latencyMs: 1 }]]) });
  });
  await page.route("**/api/ai/tts", (route) => route.fulfill({ status: 503, json: { error: "off" } }));

  const id = await createNotebook(page, "Needs a tap");
  await expect.poll(() => requests.length).toBe(1); // the normal first open spoke
  requests.length = 0;
  // Pretend this is a freshly opened tab where nothing has been clicked yet (what a browser reports before autoplay is allowed).
  await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false, isActive: false } }));
  await page.goto(`/notebooks/${id}`);
  await expect(page.getByTestId("convo-start")).toBeVisible({ timeout: 10_000 });
  expect(requests).toHaveLength(0);
  await page.getByTestId("convo-start").click();
  await expect.poll(() => requests.length, { timeout: 10_000 }).toBe(1);
  await expect(page.getByText("Hi! What are you learning today?")).toBeVisible();
});

test("a flagged mistake and its fix are raised by the tutor inside the conversation", async ({ page }) => {
  const events: { kind?: string; step?: string; hint?: string }[] = [];
  let watchCalls = 0;
  await page.route("**/api/ai/converse", async (route) => {
    const b = route.request().postDataJSON();
    if (b.event) events.push(b.event);
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: b.opening
        ? sse([["meta", { conversationId: "c1", kind: "opening", model: "m" }], ["sentence", { text: "Hi! What are you learning today?" }], ["done", { messageId: "m0", text: "x", latencyMs: 1 }]])
        : b.event?.kind === "mistake"
          ? sse([["meta", { conversationId: "c1", kind: "event", model: "m" }], ["sentence", { text: "I noticed something in that second step." }], ["sentence", { text: "Want a hint?" }], ["done", { messageId: "m1", text: "x", latencyMs: 1 }]])
          : sse([["meta", { conversationId: "c1", kind: "event", model: "m" }], ["sentence", { text: "Nice fix, well done." }], ["done", { messageId: "m2", text: "x", latencyMs: 1 }]]),
    });
  });
  await page.route("**/api/ai/tts", (route) => route.fulfill({ status: 503, json: { error: "off" } }));
  await page.route("**/api/ai/stt", (route) => route.fulfill({ json: { transcript: "" } })); // the fake mic beeps
  await page.route("**/api/ai/watch", (route) => {
    watchCalls++;
    return route.fulfill({
      json:
        watchCalls === 1
          ? { status: "flagged", problem: "p", stepCount: 2, verified: false, flag: { stepIndex: 1, latex: "2x=15", y: 150, whatsWrong: "bad subtraction", nudge: "Re-check 11 minus 3.", voiceLine: null } }
          : { status: "ok", problem: "p", stepCount: 2, flag: null, verified: false },
    });
  });

  await createNotebook(page, "Study events");
  await expect(page.getByText("Hi! What are you learning today?")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 15_000 });

  // Writing something triggers the checker (Watch my work is on by default).
  await page.getByTestId("tool-pen").click();
  const box = (await page.getByTestId("interaction-layer").boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 128, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText("I noticed something in that second step.")).toBeVisible({ timeout: 20_000 });
  expect(events[0]).toMatchObject({ kind: "mistake", step: "2x=15", hint: "Re-check 11 minus 3." });

  // They rewrite the step; the checker is happy; the tutor praises it in the conversation.
  await page.mouse.move(box.x + 120, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 168, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("Nice fix, well done.")).toBeVisible({ timeout: 25_000 });
  expect(events[1]).toMatchObject({ kind: "fixed" });
});

test("when the voice service fails the student is told, instead of hearing nothing", async ({ page }) => {
  await page.route("**/api/ai/converse", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sse([["meta", { conversationId: "c1", kind: "opening", model: "m" }], ["sentence", { text: "Hi! What are you learning today?" }], ["done", { messageId: "m0", text: "x", latencyMs: 1 }]]) }),
  );
  await page.route("**/api/ai/tts", (route) => route.fulfill({ status: 502, json: { error: { code: "tts_failed", message: "The voice service failed (500)." } } }));
  await createNotebook(page, "Voice down");
  await expect(page.getByText("Hi! What are you learning today?")).toBeVisible({ timeout: 10_000 });
  // The reply is still on screen, and a notice explains why it was not spoken (headless browsers have no built-in voice).
  await expect(page.getByTestId("convo-bar")).toContainText(/voice|speaker/i, { timeout: 25_000 });
});
