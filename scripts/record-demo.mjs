// Records a scripted demo of Math Notebook: screen video + both sides of the conversation (the practice student's
// voice through a fake microphone, and the tutor's real live voice captured inside the page), combined with ffmpeg.
//
//   node scripts/demo-make-clips.mjs                         # once: student voice clips (needs OPENAI_API_KEY)
//   BASE=https://agentic-math-tutor-orpin.vercel.app node scripts/record-demo.mjs
//
// Needs: playwright-core (installed), ffmpeg, a Chromium-based browser (PLAYWRIGHT_CHROMIUM_PATH, default Brave).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.env.OUT || path.join(root, "demo", "math-notebook-demo.mp4");
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/brave.com/brave/brave";
const SIZE = { width: 1280, height: 800 };

/* ---- the practice student's voice: clips placed on one timeline (seconds from when the microphone opens) ---- */
const STUDENT = [
  { clip: "student-1", at: 13 }, // "Hi! I'm studying quadratic equations today."
  { clip: "student-2", at: 40 }, // "How do I solve this?"
  { clip: "student-3", at: 56 }, // "Hmm, is it two and three?"
  { clip: "student-4", at: 106 }, // "What's the capital of France?"
];
const MIC_SECONDS = 140;
const RATE = 24000;

function pcmOf(file) {
  const b = fs.readFileSync(file);
  return b.subarray(b.indexOf("data") + 8);
}
function buildMicWav(file) {
  const pcm = Buffer.alloc(RATE * 2 * MIC_SECONDS);
  for (const { clip, at } of STUDENT) pcmOf(path.join(root, "demo/assets", `${clip}.wav`)).copy(pcm, Math.floor(at * RATE) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

/* ---- injected into every page: on-screen captions, a visible cursor, and a recorder for all audio in the page ---- */
function pageInit() {
  const style = document.createElement("style");
  style.textContent = `
    #demo-caption{position:fixed;left:calc(50% - 190px);bottom:78px;transform:translateX(-50%);max-width:620px;z-index:2147483647;padding:10px 18px;border-radius:12px;
      background:rgba(20,20,30,.88);color:#fff;font:600 19px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.3);
      opacity:0;transition:opacity .35s;pointer-events:none}
    #demo-caption.on{opacity:1}
    #demo-cursor{position:fixed;width:22px;height:22px;margin:-4px 0 0 -4px;border-radius:50%;background:rgba(59,91,219,.35);border:2px solid #3b5bdb;
      z-index:2147483647;pointer-events:none;transition:transform .05s}`;
  const mount = () => {
    document.head.appendChild(style);
    const cap = document.createElement("div"); cap.id = "demo-caption";
    const cur = document.createElement("div"); cur.id = "demo-cursor"; cur.style.display = "none";
    document.body.append(cap, cur);
    let hide;
    window.__caption = (t) => { clearTimeout(hide); cap.textContent = t; cap.classList.add("on"); };
    window.__captionOff = () => cap.classList.remove("on");
    document.addEventListener("mousemove", (e) => { cur.style.display = "block"; cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, true);
    document.addEventListener("mousedown", () => (cur.style.background = "rgba(59,91,219,.7)"), true);
    document.addEventListener("mouseup", () => (cur.style.background = "rgba(59,91,219,.35)"), true);
  };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  // Record the mixed audio of the call: the microphone (the practice student) and the tutor's incoming voice.
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  window.__audioStartEpoch = null;
  const attach = (stream) => {
    try { ac.createMediaStreamSource(stream).connect(dest); } catch { /* not an audio stream */ }
    if (rec.state === "inactive") { rec.start(1000); window.__audioStartEpoch = Date.now(); }
  };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); attach(s); return s; };
  const PC = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const pc = new PC(...a); pc.addEventListener("track", (e) => e.streams[0] && attach(e.streams[0])); return pc; };
  window.RTCPeerConnection.prototype = PC.prototype;
  window.__stopAudio = () => new Promise((resolve) => {
    rec.onstop = () => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.readAsDataURL(new Blob(chunks, { type: "audio/webm" })); };
    rec.state === "inactive" ? resolve("") : rec.stop();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mn-demo-"));
  const micWav = path.join(work, "mic.wav");
  buildMicWav(micWav);

  const browser = await chromium.launch({
    executablePath: BROWSER,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}%noloop`, "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ permissions: ["microphone"], baseURL: BASE, viewport: SIZE, recordVideo: { dir: work, size: SIZE } });
  await ctx.addInitScript(pageInit);
  const page = await ctx.newPage();
  const tVideo0 = Date.now();
  const say = (t) => page.evaluate((x) => window.__caption && window.__caption(x), t);
  const quiet = () => page.evaluate(() => window.__captionOff && window.__captionOff());

  // Open a new notebook from the library.
  await page.goto("/");
  await say("Math Notebook: a notebook with an AI tutor that talks with you");
  await sleep(2500);
  await page.getByRole("button", { name: "New notebook" }).first().click();
  await page.getByRole("textbox", { name: "Name" }).pressSequentially("Quadratics practice", { delay: 50 });
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/notebooks\//);
  await page.getByTestId("page-canvas").waitFor();
  const T0 = Date.now();
  const at = async (sec) => { const wait = T0 + sec * 1000 - Date.now(); if (wait > 0) await sleep(wait); };

  await say("Open a notebook: the tutor joins by itself and starts the conversation");
  await at(12);
  await say("Just talk: it listens and answers in a fraction of a second");
  await at(27);
  await say("Write your maths, then circle it with the lasso so the tutor can see exactly what you mean");

  const il = async () => (await page.getByTestId("interaction-layer").boundingBox());
  await page.getByTestId("tool-equation").click();
  let box = await il();
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 8 });
  await page.mouse.click(box.x + 160, box.y + 170);
  await page.getByTestId("equation-input").pressSequentially("x^2+5x+6=0", { delay: 90 });
  await sleep(400);
  await page.getByTestId("equation-input").press("Control+Enter");
  await sleep(600);
  const eq1 = await page.getByTestId("page-canvas").locator(".katex").first().boundingBox();
  await page.getByTestId("tool-lasso").click();
  const cx = eq1.x + eq1.width / 2, cy = eq1.y + eq1.height / 2, rx = eq1.width / 2 + 28, ry = eq1.height / 2 + 24;
  await page.mouse.move(cx + rx, cy, { steps: 12 });
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a), { steps: 3 });
    await sleep(25);
  }
  await page.mouse.up();

  await at(38);
  await say("Ask about what you circled: it gives a hint and a question, not the answer");
  await at(56);
  await say("It checks your thinking and tells you when you are right");
  await at(70);
  await say("Watch my work: write your steps and the tutor reads them as you go");
  await page.getByTestId("tool-equation").click();
  box = await il();
  await page.mouse.move(box.x + 140, box.y + 280, { steps: 14 });
  await page.mouse.click(box.x + 160, box.y + 300);
  await page.getByTestId("equation-input").pressSequentially("(x+2)(x+4)=0", { delay: 90 });
  await sleep(400);
  await page.getByTestId("equation-input").press("Control+Enter");
  await at(78);
  await say("A wrong step? The tutor spots it and brings it up gently, without giving the answer");
  await at(95);
  await say("Fix the step...");
  await page.getByTestId("tool-select").click();
  const eq2 = await page.getByTestId("page-canvas").locator(".katex").nth(1).boundingBox();
  await page.mouse.move(eq2.x + 10, eq2.y + 10, { steps: 14 });
  await page.mouse.dblclick(eq2.x + 10, eq2.y + 10);
  await page.getByTestId("equation-input").fill("");
  await page.getByTestId("equation-input").pressSequentially("(x+2)(x+3)=0", { delay: 90 });
  await sleep(400);
  await page.getByTestId("equation-input").press("Control+Enter");
  await at(100);
  await say("...and it notices, and praises you");
  await at(105);
  await say("Maths only: anything else is politely declined");
  await at(122);
  await say("Math Notebook: type, draw or talk, and the tutor talks back");
  await at(130);
  await quiet();
  await sleep(800);

  // Collect the audio, finish the video, and combine them.
  const b64 = await page.evaluate(() => window.__stopAudio());
  const audioEpoch = await page.evaluate(() => window.__audioStartEpoch);
  const videoPath = await page.video().path();
  await ctx.close();
  await browser.close();

  const audioFile = path.join(work, "audio.webm");
  fs.writeFileSync(audioFile, Buffer.from(b64, "base64"));
  const delayMs = Math.max(0, Math.round((audioEpoch ?? tVideo0) - tVideo0));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", videoPath, "-i", audioFile, "-filter_complex", `[1:a]adelay=${delayMs}|${delayMs},apad[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT],
    { stdio: "inherit" },
  );
  console.log(`saved ${OUT} (audio offset ${delayMs} ms, work files in ${work})`);
})().catch((e) => {
  console.error("demo recording failed:", e.message);
  process.exit(1);
});
