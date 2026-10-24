# Math Notebook

A mathematics-first digital notebook with an AI tutor built in. Students write, draw and type maths on pages (blank, ruled, grid or imported PDF worksheets), and the tutor checks their working **line by line**, flags the step that went wrong with a hint, and helps them fix it themselves.

**Live demo:** https://agentic-math-tutor-orpin.vercel.app/

## The problem

Maths is learned by doing, but AI help today works against that:

- **Mistakes are found too late.** With a chatbot, a student finishes the whole problem, gets a wrong answer, and only then hunts back for the error.
- **Answers replace understanding.** Chatbots hand over full solutions instead of helping the student find their own mistake.
- **Constant switching.** Every doubt means a screenshot, another app, and a lost train of thought.

Math Notebook puts the tutor *inside* the page where the work happens, so the student keeps doing the thinking.

## Key features

| Feature | What it does |
| --- | --- |
| **Watch my work** | Seconds after you pause, each step is checked. A wrong line gets a wavy underline and a hint, never the answer. **Show me** / **I'll fix it** / **Not a mistake**. Praises you when you fix it. |
| **Tutor in the notebook** | Type or talk to the tutor about whatever you circle with the lasso. No screenshots, no switching apps. |
| **Voice tutor** | Press **Talk**: it opens from your worksheet page, gives one hint and one check question, adapts, and explains fully only after three misses. Interrupts itself when you speak. Maths-only. |
| **Verified, not guessed** | SymPy checks the algebra. "Verified" appears only when the maths passes; everything else is labelled *AI-generated · not verified*. |
| **Graphing** | Plot equations from the page; the graph stays linked to its equation. |
| **PDF worksheets** | Import a PDF, annotate on top, export a clean PDF with vector equations. The original is never modified. |
| **Pen-first** | Stylus pressure, palm rejection, handwriting recognition, LaTeX equations, shapes, undo/redo and autosave. |

## Tech stack

**Frontend:** Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS 4 · Radix · Konva (ink) · perfect-freehand · KaTeX
**PDF:** PDF.js (render + text) · pdf-lib (export) · MathJax (vector equations in export)
**Backend:** Next.js Route Handlers · Prisma 7 + PostgreSQL (Supabase) · S3-compatible storage · Zod
**AI:** OpenAI GPT-4o / GPT-4o-mini (vision, step checking) · fast model for chat (GPT-4o-mini or Gemini) · OpenAI Realtime API (live voice) with a Whisper → model → TTS fallback · SymPy (verification). Works with any OpenAI-compatible endpoint, including local models.
**Testing & hosting:** Vitest · Playwright · Vercel

## How it works

- A notebook is `Notebook → Page → PageObject` (ink, text, equation, shape, graph…), never a flat image, so the tutor knows exactly which line or region you mean.
- Circled content plus an image of the region is sent to the model; extracted PDF text is passed as **untrusted data**, never as instructions.
- Every lookup is owner-scoped, and secrets stay server-side only.

## Getting started

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env      # set DATABASE_URL, SESSION_SECRET and OpenAI settings
npm run db:migrate
npm run dev               # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Signs the session cookie (≥ 32 chars) |
| `LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL` | Enable the AI tutor (`none` to disable) |
| `OPENAI_BASE_URL` | Optional custom endpoint (Azure, Ollama, LM Studio) |
| `STT_PROVIDER`, `TTS_PROVIDER`, `VOICE_ENGINE` | Voice tutor (`realtime` or `pipeline`) |
| `MATH_SERVICE_URL` | SymPy verification service |
| `STORAGE_PROVIDER` | `local`, `db` or `s3` for uploaded PDFs |

The notebook works fully without an AI key. To test without one, run `node scripts/fake-llm.mjs 4010` and point `OPENAI_BASE_URL` at `http://127.0.0.1:4010/v1`.

**Deployment:** hosted on Vercel with a Supabase Postgres database (functions pinned to Mumbai, `bom1`).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Dev server / production build / serve build |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` / `db:deploy` | Apply migrations (dev / production) |

## Roadmap

1. ✅ Working notebook (pages, ink, shapes, text, equations, lasso, autosave, undo/redo)
2. ✅ PDF import, annotation and export
3. ✅ Context-aware AI tutor panel
4. ✅ Equation graphing + SymPy verification
5. ✅ Handwriting recognition and line-by-line mistake detection
6. ✅ Voice tutor
