import type { Prisma } from "@/generated/prisma/client";
import { boundsOfObjects, objectsInLasso } from "@/lib/notebook/ops";
import { polygonFromFlat, type Rect } from "@/lib/notebook/geometry";
import type { NotebookObject } from "@/lib/notebook/schemas";
import type { Intent } from "@/lib/ai/answer";
import type { ChatRequest, ContextSummary } from "@/lib/ai/request";
import { db } from "../db";
import { notFound } from "../http";
import { objectFromRow } from "../serialize";
import { itemsInRegion, itemsNearRegion, itemsToText, searchDocs, type SearchDoc, type TextItem } from "./text-context";

/**
 * Structured notebook context for one AI request. Built on the server from the database
 * (never from client-supplied document text) and kept as small as the request allows.
 */
export interface AgentContext {
  notebook: { id: string; title: string };
  page: { id: string; number: number; total: number; type: string; documentName: string | null; pdfPage: number | null; width: number; height: number };
  region: { kind: "lasso" | "rect"; bounds: Rect } | null;
  /** Typed objects / printed text the selection covers. */
  selectedObjects: { type: string; text: string }[];
  handwritingStrokesInSelection: number;
  selectedText: string;
  nearbyText: string;
  /** Used when there is no selection. */
  pageText: string;
  /** Typed equations on or near the selection (handwriting recognition arrives later). */
  recognizedEquations: string[];
  /** Typed work after the selected problem (previous steps). */
  recentStudentSteps: string[];
  references: { page: number; source: "pdf" | "notebook"; snippet: string }[];
  scannedPageNoText: boolean;
  hasPageContent: boolean;
}

const LIMITS = { selected: 3000, nearby: 1500, page: 6000, step: 300, ref: 480 } as const;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …" : s);

const objectText = (o: NotebookObject): string | null =>
  o.type === "TEXT" ? o.data.text : o.type === "EQUATION" ? o.data.latex : o.type === "AI_SOLUTION" ? [o.data.title, ...o.data.steps.map((s) => s.latex)].join(" ") : null;

export interface PageHeader {
  id: string;
  notebookId: string;
  position: number;
}

export async function buildAgentContext(opts: { userId: string; body: ChatRequest; intent: Intent; hasPreviousAssistant: boolean }): Promise<AgentContext> {
  const { userId, body, intent } = opts;

  const page = await db.page.findFirst({
    where: { id: body.pageId, notebookId: body.notebookId, notebook: { ownerId: userId } },
    include: {
      notebook: { select: { id: true, title: true, _count: { select: { pages: true } } } },
      document: { select: { id: true, originalName: true } },
      objects: { where: { deletedAt: null }, orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!page) throw notFound("Page");

  const objects = page.objects.map(objectFromRow);
  const size = { width: page.width, height: page.height };

  // PDF text for this page (cached extraction).
  let items: TextItem[] = [];
  let scanned = false;
  if (page.documentId && page.pdfPageNumber) {
    const t = await db.documentPageText.findUnique({ where: { documentId_pageNumber: { documentId: page.documentId, pageNumber: page.pdfPageNumber } } });
    if (t) {
      items = t.items as unknown as TextItem[];
      scanned = t.source === "none";
    }
  }

  const sel = body.selection;
  const region = sel?.region ?? null;
  const polygon = region ? polygonFromFlat(region.polygon) : null;

  // Objects the selection covers: explicit ids (verified to be on this page) + geometric lasso hits.
  const onPage = new Map(objects.map((o) => [o.id, o]));
  const picked = new Map<string, NotebookObject>();
  for (const id of sel?.objectIds ?? []) {
    const o = onPage.get(id);
    if (o) picked.set(id, o);
  }
  if (polygon) for (const o of objectsInLasso(objects, polygon)) picked.set(o.id, o);
  const selectedObjs = [...picked.values()];

  const selectedObjects = selectedObjs.flatMap((o) => {
    const text = objectText(o);
    return text ? [{ type: o.type, text: clip(text, LIMITS.selected) }] : [];
  });
  const handwritingStrokes = selectedObjs.filter((o) => o.type === "INK").length;

  // Printed text under the selection, from the geometry of the cached PDF text layer.
  const bounds: Rect | null = region?.bounds ?? boundsOfObjects(selectedObjs);
  let selectedText = "";
  let nearbyText = "";
  if (items.length > 0 && bounds && (region || selectedObjs.length > 0)) {
    const inRegion = itemsInRegion(items, { polygon: polygon ?? undefined, bounds }, size);
    selectedText = itemsToText(inRegion);
    // More context above (headings, instructions) than below (the next problem is usually unrelated).
    const near = itemsNearRegion(items, bounds, size, Math.max(60, bounds.height * 1.2), Math.max(10, bounds.height * 0.25));
    const nearOnly = near.filter((i) => !inRegion.includes(i));
    nearbyText = clip(itemsToText(nearOnly), LIMITS.nearby);
  }
  // Text the student highlighted in the PDF text layer counts as the selection when no region text was found.
  const highlighted = (sel?.text ?? "").trim();
  if (highlighted) selectedText = clip(selectedText ? `${selectedText}\n${highlighted}` : highlighted, LIMITS.selected);
  selectedText = clip(selectedText, LIMITS.selected);

  // Whole-page context only when the student did not point at anything.
  const hasSelection = Boolean(region || selectedObjs.length > 0 || highlighted);
  const typedOnPage = objects.filter((o) => o.type === "TEXT" || o.type === "EQUATION");
  let pageText = "";
  if (!hasSelection) {
    pageText = items.length > 0 ? clip(itemsToText(items), LIMITS.page) : clip(typedOnPage.map((o) => objectText(o) ?? "").filter(Boolean).join("\n"), LIMITS.page);
  }

  const anchorY = bounds?.y ?? 0;
  const selectedIds = new Set(selectedObjs.map((o) => o.id));
  const recognizedEquations = typedOnPage
    .filter((o) => o.type === "EQUATION" && (selectedIds.has(o.id) || (bounds && Math.abs(o.y - bounds.y) < Math.max(200, bounds.height * 2))))
    .map((o) => clip((o as Extract<NotebookObject, { type: "EQUATION" }>).data.latex, 400))
    .slice(0, 8);
  const recentStudentSteps = bounds
    ? typedOnPage
        .filter((o) => !selectedIds.has(o.id) && o.y >= anchorY - 10)
        .sort((a, b) => a.y - b.y)
        .slice(0, 6)
        .map((o) => clip(objectText(o) ?? "", LIMITS.step))
    : [];

  const position = page.position + 1;
  const total = page.notebook._count.pages;

  // Other pages: only when the question plausibly needs them.
  const references = await findReferences({ body, intent, hasSelection, notebookId: body.notebookId, currentPageId: page.id });

  return {
    notebook: { id: page.notebook.id, title: page.notebook.title },
    page: { id: page.id, number: position, total, type: page.pageType, documentName: page.document?.originalName ?? null, pdfPage: page.pdfPageNumber, width: page.width, height: page.height },
    region: region ? { kind: region.kind, bounds: region.bounds } : null,
    selectedObjects,
    handwritingStrokesInSelection: handwritingStrokes,
    selectedText,
    nearbyText,
    pageText,
    recognizedEquations,
    recentStudentSteps,
    references,
    scannedPageNoText: scanned && items.length === 0,
    hasPageContent: items.length > 0 || typedOnPage.length > 0,
  };
}

const WANTS_REFERENCES = /\b(earlier|before|previous(ly)?|formula|theorem|definition|rule|chapter|notes?|page \d+|which page|where (is|did|was)|according to)\b/i;

async function findReferences(opts: { body: ChatRequest; intent: Intent; hasSelection: boolean; notebookId: string; currentPageId: string }) {
  const { body, intent, hasSelection } = opts;
  const open = !hasSelection && (intent === "general" || intent === "explain" || intent === "followup" || intent === "summarize");
  if (!open && !WANTS_REFERENCES.test(body.message)) return [];

  const others = await db.page.findMany({
    where: { notebookId: opts.notebookId, NOT: { id: opts.currentPageId } },
    select: {
      position: true,
      documentId: true,
      pdfPageNumber: true,
      objects: { where: { deletedAt: null, type: { in: ["TEXT", "EQUATION"] } }, select: { type: true, data: true } },
    },
  });
  const docIds = [...new Set(others.flatMap((p) => (p.documentId ? [p.documentId] : [])))];
  const texts = docIds.length
    ? await db.documentPageText.findMany({ where: { documentId: { in: docIds }, source: "pdf-text" }, select: { documentId: true, pageNumber: true, text: true } })
    : [];
  const byDoc = new Map(texts.map((t) => [`${t.documentId}:${t.pageNumber}`, t.text]));

  const docs: SearchDoc[] = [];
  for (const p of others) {
    const printed = p.documentId && p.pdfPageNumber ? byDoc.get(`${p.documentId}:${p.pdfPageNumber}`) : undefined;
    if (printed) docs.push({ page: p.position + 1, source: "pdf", text: printed });
    const typed = p.objects
      .map((o) => (o.data as Prisma.JsonObject)[o.type === "TEXT" ? "text" : "latex"])
      .filter((v): v is string => typeof v === "string")
      .join("\n");
    if (typed.trim()) docs.push({ page: p.position + 1, source: "notebook", text: typed });
  }
  return searchDocs(body.message, docs, 2, LIMITS.ref).map((h) => ({ page: h.page, source: h.source, snippet: h.snippet }));
}

export function summarizeContext(ctx: AgentContext, imageSent: boolean, imageSkipped: "no_vision" | null): ContextSummary {
  return {
    pageNumber: ctx.page.number,
    region: ctx.region !== null,
    selectedObjects: ctx.selectedObjects.length + ctx.handwritingStrokesInSelection,
    selectedTextChars: ctx.selectedText.length,
    nearbyTextChars: ctx.nearbyText.length,
    imageSent,
    imageSkipped,
    scannedPageNoText: ctx.scannedPageNoText,
    references: ctx.references.map((r) => ({ page: r.page, source: r.source })),
  };
}
