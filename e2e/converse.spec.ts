import { expect, test } from "@playwright/test";
import { createNotebook } from "./helpers";

// A fake microphone (silence) lets the real getUserMedia / VAD code run headlessly.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

test("conversation mode: typed turn gets an ack, a streamed reply, speech in order, and the selection travels along", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  const spoken: string[] = [];
  await page.route("**/api/ai/converse", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: sse([
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
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 10_000 });

  await page.getByTestId("convo-say").fill("how do I solve this");
  await page.getByTestId("convo-say").press("Enter");

  await expect(page.getByText("Try factoring the equation you circled.")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => spoken.slice(0, 3)).toEqual([
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
