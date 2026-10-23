// Copies the pdf.js worker and static data into public/pdfjs so the browser loads them
// same-origin (no bundler URL magic). Runs on postinstall; keeps versions in lockstep.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "pdfjs-dist");
const dest = path.join(root, "public", "pdfjs");

if (!existsSync(src)) {
  console.warn("pdfjs-dist not installed yet; skipping asset copy");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(path.join(src, "build", "pdf.worker.min.mjs"), path.join(dest, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
console.log("pdf.js assets copied to public/pdfjs");
