# Math Notebook

A mathematics-first digital notebook. Students write, draw and type maths on pages (blank / ruled / grid, and later imported PDFs), and an AI tutor that lives inside the workspace helps them using the actual contents of the page.

> **Status:** Phases 1 (working notebook) and 2 (PDF import, annotation, export) are complete. AI, graphs, handwriting recognition and voice are planned phases — see [Roadmap](#roadmap). Nothing in the UI is a placeholder: features that are not built yet are not shown.

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS 4 · Radix primitives · Lucide · Konva / React-Konva (ink renderer) · KaTeX · perfect-freehand · PDF.js (render + text) · pdf-lib (export) · MathJax (equation vectors for export) · Prisma 7 + PostgreSQL · S3-compatible storage · Zod · Vitest · Playwright.

## Getting started

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install                      # also runs `prisma generate` and copies pdf.js assets to public/pdfjs
cp .env.example .env             # then edit DATABASE_URL and SESSION_SECRET
npm run db:migrate               # applies migrations (creates tables)
npm run dev                      # http://localhost:3000
```

Create a local database (example):

```sql
CREATE USER mathnb WITH PASSWORD 'mathnb' CREATEDB;
CREATE DATABASE mathnb OWNER mathnb;
```

### Environment variables

See [`.env.example`](.env.example) — placeholders only. **Secrets are server-side only**; there are no `NEXT_PUBLIC_*` variables. All variables are validated with Zod in `src/lib/server/env.ts`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | yes (≥ 32 chars) | Signs the session cookie |
| `STORAGE_PROVIDER` (`local`\|`s3`), `LOCAL_STORAGE_DIR` | no (default: local `./storage-data`) | Where uploaded PDFs live |
| `OBJECT_STORAGE_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY` | when `STORAGE_PROVIDER=s3` | Any S3-compatible store (AWS S3, R2, MinIO, B2) |
| `MAX_PDF_MB` | no (default 50) | Upload size limit |
| `LLM_PROVIDER`, `OPENAI_*`, `GROQ_*` | phase 3 | AI tutor (optional — the notebook works without) |
| `STT_PROVIDER`, `TTS_PROVIDER`, `GRADIUM_API_KEY`, `OPENAI_TTS_*` | phase 6 | Voice (optional) |
| `MATH_SERVICE_URL` | phase 4 | SymPy verification service (optional) |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next + React Compiler rules) |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests (starts `npm run dev` if nothing is running; set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled Chromium). For stable timings run against a production build: `npm run build && npm start -- -p 3100`, then `E2E_BASE_URL=http://localhost:3100 npm run test:e2e` |
| `python3 scripts/make-fixtures.py` | Regenerates the PDF fixtures (digital, scanned, corrupt) in `e2e/fixtures` (needs reportlab + Pillow) |
| `npm run db:migrate` | `prisma migrate dev` (creates + applies migrations) |
| `npm run db:deploy` | `prisma migrate deploy` (production) |

## Architecture

```
src/
  app/                    Next.js routes + Route Handlers (api/*)
  components/library/     Notebook library (home)
  components/workspace/   Notebook workspace (canvas, toolbar, sidebar, editors)
  components/ui/          Small Radix-based primitives
  lib/notebook/           Framework-free model: Zod schemas, geometry, ops, store reducer
  lib/client/             Typed API client, device helpers
  lib/server/             env, db, session, access (authz), http helpers
prisma/                   schema.prisma + migrations
e2e/                      Playwright tests
```

### Notebook model

A notebook is `Notebook → Page → PageObject`, never a flat image. Each object has a stable id, type (`INK`, `TEXT`, `EQUATION`, `SHAPE`, `GRAPH`, `IMAGE`, `AI_SOLUTION`, `SELECTION`), geometry in **page units**, z-order, source (`USER`/`AI`), optional `linkedToId` (e.g. graph ↔ equation), timestamps and a library-independent JSON `data` payload validated per type by Zod (`src/lib/notebook/schemas.ts`). Ink stores relative points plus per-point pressure and timing when the device provides them. Normalised coordinates are `x / page.width`, `y / page.height` (`toNormalised` / `fromNormalised`), which is how regions will map between canvas, PDF page and export.

### Layering on a page (bottom → top)

1. Page background — CSS pattern (PDF raster in phase 2). Never modified by editing.
2. Text / equation / graph objects — real DOM (crisp, selectable; KaTeX).
3. Ink and shapes — Konva, **render-only** (no listeners, no hit graph).
4. Interaction layer — all pointer input (pen/mouse/touch, pressure, coalesced events), live previews drawn imperatively (no React re-render per pointer move), selection frame.
5. In-place editors (text, equation).

### PDFs

1. **Upload** (`POST /api/documents`, multipart): MIME + `%PDF-` magic check, size limit (`MAX_PDF_MB`), page limit (500), parse with pdf.js (time-limited, no font loading, encrypted/corrupt files rejected with a clear message and nothing is created).
2. **Store** the original bytes unmodified through the storage abstraction (`src/lib/server/storage`: local disk or any S3-compatible store). The DB keeps only metadata — never file bytes.
3. **Create** one `Page` (type `PDF`, size in PDF points, `documentId` + `pdfPageNumber`) per PDF page, so the notebook opens immediately.
4. **Extract text** in the background (`after()` → `processDocument`): per-page text plus normalised item boxes are cached in `DocumentPageText`. Status is `PROCESSING → READY | FAILED`; the notebook is fully usable while it runs, and a failure never blocks annotation. Pages without a text layer (scans) are recorded as `source = none` and shown in the UI as "Scanned page"; OCR is not run in this phase.
5. **Serve** the original through an owner-checked route (`/api/documents/:id/file`); PDF.js renders it in the browser. Annotations are ordinary page objects stored separately, so the original is never rewritten.
6. **Export** (`GET /api/notebooks/:id/export`): original pages are copied with pdf-lib (content untouched) and annotations are drawn on top — ink as filled outlines, shapes, text, and equations as **vector outlines** (MathJax, restricted TeX package allowlist) with correct handling of `/Rotate`. Notebook pages become Letter-size pages.

Treat all extracted PDF text as **untrusted** content (it will be passed to the AI as document data, never as instructions).

### History and saving

Undo/redo is a stack of `{before, after}` object changes (`src/lib/notebook/store.ts`) — one entry per gesture (a drag-erase of many strokes is one undo step). Every change marks objects dirty with a revision number; autosave debounces (800 ms), sends only dirty objects as one batch per page, and the revision check keeps edits made *during* a save dirty. Deletes are soft (`deletedAt`) so student work stays recoverable. Undo history is per session (not persisted).

### Identity and authorization

Until real authentication (Phase 7) each browser receives a signed HttpOnly cookie mapped to a guest `User`. Every route resolves the user via `requireUser()` and every lookup is scoped by owner (`src/lib/server/access.ts`); other users' resources return 404. Replacing `session.ts` with a real auth provider does not change route authorization.

## Input support

Mouse, touch and stylus via Pointer Events. Stylus pressure is recorded only when the device reports varying pressure. Once a stylus is seen in a tab, finger touches pan instead of draw (palm rejection). Shortcuts: `V` select, `P` pen, `C` pencil, `H` highlighter, `E` eraser, `L` lasso, `S` shapes, `T` text, `M` equation, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo, `Ctrl/⌘+D` duplicate, `Delete` remove, `Ctrl/⌘+wheel` zoom.

## Known limitations

- Guest identity only; no sign-in, so a notebook is tied to the browser's cookie.
- The whole notebook (all pages and objects) loads at once; per-page lazy loading is a later optimisation.
- Page operations (add / delete / reorder / background) are immediate server calls and are not part of undo.
- Soft-deleted objects are kept indefinitely; there is no purge job yet.
- Highlighter uses normal alpha blending (no multiply blend against the page).
- Page thumbnails are simplified SVG previews.
- Light theme only.
- PDF text extraction runs in the web process (time-limited). For large workloads move `processDocument` to a worker (the function is the seam).
- **No OCR yet.** Scanned PDFs can be viewed and annotated; they are flagged as having no text layer. Vision/OCR for scans arrives with the AI phases.
- PDF export: text uses the standard PDF fonts (characters outside Latin-1 are replaced with `?`); equations are vector but typeset by MathJax so spacing can differ slightly from KaTeX on screen; graph, image and AI-solution objects will be added to export as those object types ship. Original form fields/links are preserved only on copied PDF pages.
- Dev-server note: after switching between `next build` and `next dev`, or after changing `next.config.ts`, delete `.next` if the page reloads in a loop.

## Roadmap

1. ✅ Working notebook (library, pages, ink, shapes, text, equations, selection, lasso, autosave, undo/redo)
2. ✅ PDF import, rendering, annotation, export
3. Context-aware AI panel (provider abstraction, selection-aware requests)
4. Equation graphing + SymPy verification
5. Handwriting recognition, mistake detection, solution placement
6. Voice
7. Hardening (auth, rate limits, monitoring, deployment docs)
