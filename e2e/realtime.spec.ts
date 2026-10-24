import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createNotebook } from "./helpers";

// A fake microphone (silence) so getUserMedia succeeds headlessly. The WebRTC call itself is replaced by a stand-in
// whose data channel the test drives, so every behaviour of the live-call engine can be checked without OpenAI.
test.use({
  permissions: ["microphone"],
  storageState: { cookies: [], origins: [] },
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${path.resolve(__dirname, "fixtures", "silence.wav")}%noloop`],
  },
});

/** 0.1 s of silence as a WAV, so the standard voice has something valid to "play". */
const SILENT_WAV = (() => {
  const n = 2400;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
})();

type Sent = { type: string; item?: { role: string; content: { type: string; text?: string }[] }; response?: unknown };

async function installFakeCall(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __sent: unknown[]; __emit: (e: object) => void; __rtClosed: number };
    w.__sent = [];
    w.__rtClosed = 0;
    class FakeChannel {
      readyState = "connecting";
      onopen: (() => void) | null = null;
      onmessage: ((m: { data: string }) => void) | null = null;
      send(d: string) {
        w.__sent.push(JSON.parse(d));
      }
      close() {
        this.readyState = "closed";
      }
    }
    class FakePC {
      connectionState = "new";
      ontrack = null;
      onconnectionstatechange = null;
      private ch: FakeChannel | null = null;
      addTrack() {}
      addTransceiver() {}
      createDataChannel() {
        this.ch = new FakeChannel();
        w.__emit = (e: object) => this.ch!.onmessage?.({ data: JSON.stringify(e) });
        return this.ch as unknown as RTCDataChannel;
      }
      async createOffer() {
        return { type: "offer", sdp: "v=0" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.ch!.readyState = "open";
        this.ch!.onopen?.();
      }
      close() {
        w.__rtClosed++;
      }
    }
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePC;
  });
}

const sentNow = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Sent[] }).__sent);
const emit = (page: Page, ev: object) => page.evaluate((e) => (window as unknown as { __emit: (e: object) => void }).__emit(e), ev);

test.beforeEach(async ({ page }) => {
  await installFakeCall(page);
  await page.route("**/api.openai.com/v1/realtime/calls", (route) => route.fulfill({ status: 201, contentType: "application/sdp", body: "v=0" }));
});

test("the live call opens by itself, makes the tutor speak first, and shows what is said", async ({ page }) => {
  const logged: { role: string; text: string }[] = [];
  await page.route("**/api/ai/realtime/session", (route) =>
    route.fulfill({ json: { clientSecret: "ek_test", expiresAt: 0, model: "gpt-realtime", conversationId: "c1", history: [{ role: "user", text: "earlier question" }], openingTask: "[app] OPEN THE CONVERSATION" } }),
  );
  await page.route("**/api/ai/realtime/context", (route) => route.fulfill({ json: { text: "[context] the page is empty" } }));
  await page.route("**/api/ai/realtime/log", async (route) => {
    logged.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });

  await createNotebook(page, "Live call");
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 15_000 });

  // Memory replay, then the opening task as a normal message (never a response-level instructions override), then a reply.
  const sent = await sentNow(page);
  const kinds = sent.map((s) => s.type);
  expect(kinds.indexOf("conversation.item.create")).toBeGreaterThanOrEqual(0);
  const texts = sent.flatMap((s) => (s.type === "conversation.item.create" ? [s.item!.content[0]!.text] : []));
  expect(texts[0]).toBe("earlier question");
  expect(texts).toContain("[app] OPEN THE CONVERSATION");
  const create = sent.find((s) => s.type === "response.create")!;
  expect(create.response).toBeUndefined();

  // The tutor's reply streams in as text and lands in the panel.
  await emit(page, { type: "response.created" });
  await emit(page, { type: "response.output_audio_transcript.delta", delta: "Hello! What are you " });
  await emit(page, { type: "output_audio_buffer.started" });
  await expect(page.getByTestId("convo-state")).toHaveText(/Speaking/);
  await emit(page, { type: "response.output_audio_transcript.delta", delta: "learning today?" });
  await emit(page, { type: "response.output_audio_transcript.done", transcript: "Hello! What are you learning today?" });
  await emit(page, { type: "output_audio_buffer.stopped" });
  await expect(page.getByText("Hello! What are you learning today?")).toBeVisible();
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/);
  await expect.poll(() => logged.filter((l) => l.role === "assistant").map((l) => l.text)).toContain("Hello! What are you learning today?");

  // The student speaks: the state follows and the transcript appears before the tutor's answer.
  await emit(page, { type: "input_audio_buffer.speech_started" });
  await expect(page.getByTestId("convo-state")).toHaveText(/Hearing/);
  await emit(page, { type: "input_audio_buffer.speech_stopped" });
  await emit(page, { type: "response.created" });
  await emit(page, { type: "response.output_audio_transcript.delta", delta: "Great, quadratics." });
  await emit(page, { type: "conversation.item.input_audio_transcription.completed", transcript: "I am learning quadratics" });
  await emit(page, { type: "response.output_audio_transcript.done", transcript: "Great, quadratics." });
  await expect(page.getByText("I am learning quadratics")).toBeVisible();
  const order = await page.getByTestId("ai-panel").innerText();
  expect(order.indexOf("I am learning quadratics")).toBeLessThan(order.indexOf("Great, quadratics."));
  await expect.poll(() => logged.filter((l) => l.role === "user").map((l) => l.text)).toContain("I am learning quadratics");

  // Typing instead of speaking goes into the same call.
  await page.getByTestId("convo-say").fill("how do I factor this");
  await page.getByTestId("convo-say").press("Enter");
  const after = await sentNow(page);
  expect(after.some((s) => s.type === "conversation.item.create" && s.item?.role === "user" && s.item.content[0]?.text === "how do I factor this")).toBe(true);

  // Turning Talk off hangs up the call.
  await page.getByTestId("convo-toggle").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __rtClosed: number }).__rtClosed)).toBeGreaterThan(0);
});

test("circling something tells the tutor what is circled, without making it talk", async ({ page }) => {
  let contexts = 0;
  await page.route("**/api/ai/realtime/session", (route) => route.fulfill({ json: { clientSecret: "ek", expiresAt: 0, model: "m", conversationId: "c1", history: [], openingTask: "[app] OPEN" } }));
  await page.route("**/api/ai/realtime/context", (route) => {
    contexts++;
    return route.fulfill({ json: { text: `[context] circled equation #${contexts}` } });
  });
  await page.route("**/api/ai/realtime/log", (route) => route.fulfill({ json: { ok: true } }));
  await createNotebook(page, "Circle");
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 15_000 });
  const before = (await sentNow(page)).filter((s) => s.type === "response.create").length;

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

  await expect.poll(async () => (await sentNow(page)).flatMap((s) => (s.type === "conversation.item.create" ? [s.item!.content[0]!.text ?? ""] : [])).filter((t) => t.startsWith("[context] circled")).length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect((await sentNow(page)).filter((s) => s.type === "response.create").length).toBe(before); // context is a note, not a prompt
});

test("a flagged mistake and its fix are raised inside the call, after the student has finished speaking", async ({ page }) => {
  let watch = 0;
  await page.route("**/api/ai/realtime/session", (route) => route.fulfill({ json: { clientSecret: "ek", expiresAt: 0, model: "m", conversationId: "c1", history: [], openingTask: "[app] OPEN" } }));
  await page.route("**/api/ai/realtime/context", (route) => route.fulfill({ json: { text: "[context] x" } }));
  await page.route("**/api/ai/realtime/log", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/ai/watch", (route) => {
    watch++;
    return route.fulfill({
      json:
        watch === 1
          ? { status: "flagged", problem: "p", stepCount: 2, verified: false, flag: { stepIndex: 1, latex: "2x=15", y: 150, whatsWrong: "bad subtraction", nudge: "Re-check 11 minus 3.", voiceLine: null } }
          : { status: "ok", problem: "p", stepCount: 2, flag: null, verified: false },
    });
  });
  await createNotebook(page, "Mistakes");
  await expect(page.getByTestId("convo-state")).toHaveText(/Listening/, { timeout: 15_000 });

  const stroke = async (y: number) => {
    await page.getByTestId("tool-pen").click();
    const b = (await page.getByTestId("interaction-layer").boundingBox())!;
    await page.mouse.move(b.x + 120, b.y + y);
    await page.mouse.down();
    await page.mouse.move(b.x + 260, b.y + y + 8, { steps: 10 });
    await page.mouse.up();
  };
  // The student is speaking when the mistake is found: the tutor waits for them to finish.
  await emit(page, { type: "input_audio_buffer.speech_started" });
  await stroke(120);
  await expect.poll(() => watch, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(1200);
  const mid = (await sentNow(page)).flatMap((s) => (s.type === "conversation.item.create" ? [s.item!.content[0]!.text ?? ""] : []));
  expect(mid.some((t) => t.startsWith("[checker]"))).toBe(false);

  await emit(page, { type: "input_audio_buffer.speech_stopped" });
  await emit(page, { type: "response.created" });
  await emit(page, { type: "response.output_audio_transcript.delta", delta: "Okay." });
  await emit(page, { type: "output_audio_buffer.started" });
  await emit(page, { type: "response.output_audio_transcript.done", transcript: "Okay." });
  await emit(page, { type: "output_audio_buffer.stopped" }); // the tutor finished: now it can raise the mistake
  await expect.poll(async () => (await sentNow(page)).flatMap((s) => (s.type === "conversation.item.create" ? [s.item!.content[0]!.text ?? ""] : [])).some((t) => t.startsWith("[checker]") && t.includes("2x=15") && t.includes("Re-check 11 minus 3.")), { timeout: 15_000 }).toBe(true);
  // ...and the task is a message, never an instruction override.
  const creates = (await sentNow(page)).filter((s) => s.type === "response.create");
  expect(creates.every((c) => c.response === undefined)).toBe(true);
});

test("if the live call cannot start, the standard voice takes over and says so", async ({ page }) => {
  await page.route("**/api/ai/realtime/session", (route) => route.fulfill({ status: 502, json: { error: { code: "realtime_failed", message: "The voice service refused the call (500)." } } }));
  await page.route("**/api/ai/converse", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: `event: meta\ndata: ${JSON.stringify({ conversationId: "c1", kind: "opening", model: "m" })}\n\nevent: sentence\ndata: ${JSON.stringify({ text: "Hi from the standard voice." })}\n\nevent: done\ndata: ${JSON.stringify({ messageId: "m", text: "x", latencyMs: 1 })}\n\n` }),
  );
  await page.route("**/api/ai/tts", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: SILENT_WAV }));
  await createNotebook(page, "Fallback");
  await expect(page.getByText("Hi from the standard voice.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("convo-bar")).toContainText(/standard voice/i);
});
