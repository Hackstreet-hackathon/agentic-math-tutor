import path from "node:path";
import { expect, test } from "@playwright/test";
import { createNotebook, usePipelineVoice } from "./helpers";

// A fake microphone (silence) lets the real getUserMedia / VAD code run headlessly.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${path.resolve(__dirname, "fixtures", "silence.wav")}%noloop`],
  },
});

const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

test("conversation mode: typed turn gets an ack, a streamed reply, speech in order, and the selection travels along", async ({ page }) => {
  await usePipelineVoice(page);
  const requests: Record<string, unknown>[] = [];
  const spoken: string[] = [];
  await page.route("**/api/ai/converse", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: body.opening
        ? sse([
            ["meta", { conversationId: "c1", kind: "opening", model: "gpt-4o" }],
            ["sentence", { text: "Hi! What are you learning today?" }],
            ["done", { messageId: "m0", text: "x", latencyMs: 10 }],
          ])
        : sse([
            ["meta", { conversationId: "c1", kind: "math", model: "gpt-4o" }],
            ["ack", { text: "Good question, let me look at that." }],
            ["sentence", { text: "Try factoring the equation you circled." }],
            ["sentence", { text: "What two numbers multiply to six and add to five?" }],
            ["state", { tutorState: { goal: "factor quadratic", stage: "check", attempts: 0 } }],
            ["done", { messageId: "m1", text: "x", latencyMs: 10 }],
          ]),
    });
  });
  await page.route("**/api/ai/tts", async (route) => {
    spoken.push(route.request().postDataJSON().text);
    await route.fulfill({ status: 503, json: { error: "off" } }); // falls back to the browser voice
  });

  await createNotebook(page, "Convo");
  // Typed text object so there is something selectable on the page.
  await page.getByTestId("toggle-ai").click();
  await page.getByTestId("convo-toggle").click();
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening|Speaking/, { timeout: 10_000 });
  // Turning listening on makes the tutor speak first (no transcript, just an opening request).
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ opening: true });
  expect(requests[0]).not.toHaveProperty("transcript");
  requests.length = 0;
  await expect(page.getByText("Hi! What are you learning today?")).toBeVisible();
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 15_000 });

  await page.getByTestId("convo-say").fill("how do I solve this");
  await page.getByTestId("convo-say").press("Enter");

  await expect(page.getByText("Try factoring the equation you circled.")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => spoken.slice(1, 4)).toEqual([
    "Good question, let me look at that.",
    "Try factoring the equation you circled.",
    "What two numbers multiply to six and add to five?",
  ]);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ transcript: "how do I solve this", tutorState: { stage: "idle" } });

  // The next turn carries the tutor's state so it can continue the exchange.
  await page.getByTestId("convo-say").fill("is it two and three");
  await page.getByTestId("convo-say").press("Enter");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ conversationId: "c1", tutorState: { stage: "check", goal: "factor quadratic" } });

  // Toggle off stops the mic and the bar disappears.
  await page.getByTestId("convo-toggle").click();
  await expect(page.getByTestId("convo-bar")).toHaveCount(0);
});
