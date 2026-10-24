// Generates the practice student's spoken lines for the demo recording (needs OPENAI_API_KEY in .env).
// Usage: node scripts/demo-make-clips.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const lines = {
  "student-1": "Hi! I'm studying quadratic equations today.",
  "student-2": "How do I solve this?",
  "student-3": "Hmm, is it two and three?",
  "student-4": "What's the capital of France?",
};
for (const [name, input] of Object.entries(lines)) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "ash", response_format: "wav", instructions: "Friendly teenage student, natural pace.", input }),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  fs.writeFileSync(path.join(root, "demo/assets", `${name}.wav`), Buffer.from(await res.arrayBuffer()));
  console.log("wrote", name);
}
