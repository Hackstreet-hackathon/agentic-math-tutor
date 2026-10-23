"use client";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type DocumentDto, type NotebookDto } from "@/lib/client/api";
import { measurePdfObstacles } from "@/lib/client/pdf-occupancy";
import { boundsOf, clamp, type Rect } from "@/lib/notebook/geometry";
import { estimateSolutionHeight, findFreeSpot, SOLUTION_WIDTH } from "@/lib/notebook/placement";
import type { AiSolutionObject, GraphObject } from "@/lib/notebook/schemas";
import type { Change } from "@/lib/notebook/ops";
import { currentPage, initialState, reducer } from "@/lib/notebook/store";
import { newId } from "@/lib/utils";
import { initialEditor, MAX_ZOOM, MIN_ZOOM, type EditorState } from "./editor";
import { AiPanel, type InsertRequest } from "./ai-panel";
import { GraphPanel } from "./graph-panel";
import { PageCanvas } from "./page-canvas";
import { Sidebar } from "./sidebar";
import { DrawingToolbar, TOOL_SHORTCUTS } from "./toolbar";
import { TopBar, ZoomControls } from "./topbar";
import { useAutosave } from "./use-autosave";

type Load = { state: "loading" } | { state: "error"; status: number; message: string } | { state: "ready"; notebook: NotebookDto };

export function Workspace({ notebookId }: { notebookId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .getNotebook(notebookId)
      .then(({ notebook }) => !cancelled && setLoad({ state: "ready", notebook }))
      .catch((e: { status?: number; message?: string }) =>
        !cancelled && setLoad({ state: "error", status: e.status ?? 0, message: e.message ?? "Could not open this notebook" }),
      );
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  if (load.state === "loading") {
    return (
      <div className="grid h-screen place-items-center text-sm text-muted" aria-busy="true">
        Opening notebook…
      </div>
    );
  }
  if (load.state === "error") {
    return (
      <div className="grid h-screen place-items-center p-6">
        <div role="alert" className="max-w-sm rounded-2xl border border-line bg-white p-8 text-center">
          <p className="font-medium">{load.status === 404 ? "Notebook not found" : "Couldn’t open this notebook"}</p>
          <p className="mt-1 text-sm text-muted">
            {load.status === 404 ? "It may have been deleted, or it belongs to another account." : load.message}
          </p>
          <Link href="/" className="mt-5 inline-block">
            <Button variant="primary">Back to library</Button>
          </Link>
        </div>
      </div>
    );
  }
  return <WorkspaceReady notebook={load.notebook} />;
}

function WorkspaceReady({ notebook }: { notebook: NotebookDto }) {
  const [state, dispatch] = useReducer(reducer, notebook.pages, (pages) => initialState(pages));
  const [editor, setEditor] = useState<EditorState>(initialEditor);
  const [title, setTitle] = useState(notebook.title);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [docs, setDocs] = useState<Record<string, DocState>>(() => Object.fromEntries(notebook.documents.map((d) => [d.id, d])));
  const scrollRef = useRef<HTMLDivElement>(null);
  const { status, flush, saveNow } = useAutosave(state, dispatch);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const [exporting, setExporting] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiFocus, setAiFocus] = useState(0);
  const [graphOpen, setGraphOpen] = useState(false);
  const [textSelection, setTextSelection] = useState("");
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null);

  const page = currentPage(state);

  // Poll text-extraction status while any document is still processing; the notebook stays usable meanwhile.
  const pendingIds = Object.values(docs).filter((d) => d.status === "UPLOADED" || d.status === "PROCESSING").map((d) => d.id).join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const timer = setInterval(async () => {
      for (const id of pendingIds.split(",")) {
        try {
          const { document } = await api.getDocument(id);
          setDocs((d) => ({ ...d, [id]: document }));
        } catch {
          /* transient; try again on the next tick */
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pendingIds]);

  const notice = documentNotice(Object.values(docs), page?.documentId ?? null, page?.pdfPageNumber ?? null);

  /** Heights of AI cards are measured after layout so selection frames fit them. */
  const measureObject = useCallback(
    (id: string) => (height: number) => {
      const pg = stateRef.current.pages.find((p) => p.id === stateRef.current.currentPageId);
      const o = pg?.objects.find((x) => x.id === id);
      if (pg && o && Math.abs(o.height - height) > 2) dispatch({ type: "silent", pageId: pg.id, changes: [{ before: o, after: { ...o, height } }] });
    },
    [],
  );
  const onMeasure = useCallback((id: string, height: number) => measureObject(id)(height), [measureObject]);

  /** Write an AI answer onto the page as an editable, movable, undoable object, in free space. */
  const insertSolution = async (req: InsertRequest): Promise<boolean> => {
    if (!page) return false;
    const steps = req.answer.steps.filter((s) => s.latex || s.explanation).map((s) => ({ latex: s.latex ?? "", explanation: s.explanation }));
    const data: AiSolutionObject["data"] = {
      title: "Solution",
      steps,
      finalAnswer: req.answer.finalAnswer ?? undefined,
      verificationStatus: req.verification.status,
      sourceQuestion: req.sourceQuestion.slice(0, 300) || undefined,
      messageId: req.messageId,
    };
    const width = Math.min(SOLUTION_WIDTH, page.width - 72);
    const height = estimateSolutionHeight({ steps, finalAnswer: data.finalAnswer }, width);
    const lastStudent = [...page.objects].reverse().find((o) => o.source === "USER");
    const anchor: Rect | null = req.region ?? (lastStudent ? boundsOf(lastStudent) : null);
    const obstacles = [...page.objects.map(boundsOf), ...(page.pageType === "PDF" ? measurePdfObstacles(page) : [])];
    const spot = findFreeSpot({ page, obstacles, anchor, size: { width, height } });

    const make = (x: number, y: number, zIndex: number): AiSolutionObject => ({
      id: newId(), type: "AI_SOLUTION", source: "AI", x, y, width, height, rotation: 0, zIndex, linkedToId: null, metadata: null, data,
    });
    const z = page.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
    try {
      if (spot.kind === "free") {
        const obj = make(spot.x, spot.y, z);
        dispatch({ type: "commit", pageId: page.id, changes: [{ before: null, after: obj }] });
        setEditor((e) => ({ ...e, tool: "select", selectedIds: [obj.id], region: null }));
      } else {
        // Never overwrite student work: continue on a fresh page instead.
        const { page: fresh } = await api.addPage(notebook.id, { afterPosition: page.position });
        dispatch({ type: "pageAdded", page: fresh });
        const obj = make(36, 36, 1);
        dispatch({ type: "commit", pageId: fresh.id, changes: [{ before: null, after: obj }] });
        setEditor((e) => ({ ...e, tool: "select", selectedIds: [obj.id], region: null, editing: null }));
        showError("There wasn’t enough free space here, so the solution was written on a new page.");
      }
      return true;
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not add the solution to the page");
      return false;
    }
  };

  const insertGraph = useCallback((expressions: GraphObject["data"]["expressions"], viewport: GraphObject["data"]["viewport"]) => {
    if (!page) return;
    const width = Math.min(400, page.width - 72);
    const height = 300;
    const obstacles = page.objects.map(boundsOf);
    const spot = findFreeSpot({ page, obstacles, anchor: null, size: { width, height } });
    const pos = spot.kind === "free" ? { x: spot.x, y: spot.y } : { x: 36, y: 36 };
    const z = page.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
    const obj: GraphObject = {
      id: newId(), type: "GRAPH", source: "USER",
      x: pos.x, y: pos.y, width, height, rotation: 0, zIndex: z,
      linkedToId: expressions[0]?.sourceObjectId ?? null, metadata: null,
      data: { expressions, viewport },
    };
    dispatch({ type: "commit", pageId: page.id, changes: [{ before: null, after: obj }] });
  }, [page, dispatch]);

  const exportPdf = async () => {
    setExporting(true);
    try {
      // The export is built from saved data, so flush pending edits first.
      if (!(await saveNow())) throw new Error("Your latest changes could not be saved yet. Check your connection and try again.");
      const res = await fetch(`/api/notebooks/${notebook.id}/export`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[\\/:*?"<>|]+/g, "").trim() || "notebook"}-annotated.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const skipped = Number(res.headers.get("X-Export-Skipped") ?? 0);
      if (skipped > 0) showError(`Exported. ${skipped} object${skipped === 1 ? "" : "s"} could not be drawn into the PDF (e.g. invalid equations).`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const importPdf = async (file: File) => {
    setImporting(true);
    try {
      const res = await api.importPdf(file, notebook.id);
      const { notebook: fresh } = await api.getNotebook(notebook.id);
      dispatch({ type: "pagesAppended", pages: fresh.pages });
      setDocs(Object.fromEntries(fresh.documents.map((d) => [d.id, d])));
      const first = fresh.pages.find((p) => p.documentId === res.document.id);
      if (first) goToPage(first.id);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not import the PDF");
    } finally {
      setImporting(false);
    }
  };
  const pageIndex = state.pages.findIndex((p) => p.id === state.currentPageId);

  const patchEditor = useCallback((p: Partial<EditorState>) => setEditor((e) => ({ ...e, ...p })), []);
  const showError = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    document.title = `${title} · Math Notebook`;
  }, [title]);

  /* ----- zoom: fit to width until the user zooms manually ----- */
  const pageWidth = page?.width ?? 816;
  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const z = clamp((el.clientWidth - 48) / pageWidth, MIN_ZOOM, 1.5);
    setEditor((e) => ({ ...e, zoom: Math.round(z * 100) / 100, autoFit: true }));
  }, [pageWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setEditor((e) => (e.autoFit ? { ...e, zoom: Math.round(clamp((el.clientWidth - 48) / pageWidth, MIN_ZOOM, 1.5) * 100) / 100 } : e)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageWidth, sidebarOpen]);

  const setZoom = useCallback((z: number) => setEditor((e) => ({ ...e, zoom: clamp(Math.round(z * 100) / 100, MIN_ZOOM, MAX_ZOOM), autoFit: false })), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setEditor((ed) => ({ ...ed, zoom: clamp(ed.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM), autoFit: false }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ----- selection housekeeping: ignore ids that no longer exist (e.g. after undo) ----- */
  const isPdfPage = page?.pageType === "PDF";
  const liveEditor = useMemo(() => {
    let e = editor;
    // PDF-only tool falls back to Select on other pages.
    if (e.tool === "textselect" && !isPdfPage) e = { ...e, tool: "select" };
    if (e.selectedIds.length === 0) return e;
    const ids = new Set(page?.objects.map((o) => o.id));
    const kept = e.selectedIds.filter((id) => ids.has(id));
    return kept.length === e.selectedIds.length ? e : { ...e, selectedIds: kept };
  }, [editor, page?.objects, isPdfPage]);

  /* ----- text selected in the PDF text layer becomes AI context (only via the explicit Ask AI action) ----- */
  useEffect(() => {
    if (editor.tool !== "textselect") return;
    const onChange = () => {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return; // typing in the AI box
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.anchorNode) return;
      const layer = document.querySelector('[data-testid="pdf-text-layer"]');
      if (!layer || !layer.contains(sel.anchorNode)) return;
      setTextSelection(sel.toString().replace(/\s+/g, " ").trim().slice(0, 3000));
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setSelectionAnchor({ x: r.right, y: r.top });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [editor.tool]);

  const clearAiSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setTextSelection("");
    setSelectionAnchor(null);
    setEditor((e) => ({ ...e, selectedIds: [], region: null }));
  }, []);

  const askAi = useCallback(() => {
    setAiOpen(true);
    setAiFocus((n) => n + 1);
  }, []);

  const goToPage = useCallback(
    (pageId: string) => {
      setTextSelection("");
      setSelectionAnchor(null);
      setEditor((e) => ({ ...e, selectedIds: [], region: null, editing: null }));
      dispatch({ type: "setPage", pageId });
    },
    [dispatch],
  );
  const onCommit = useCallback((pageId: string, changes: Change[]) => {
    dispatch({ type: "commit", pageId, changes });
  }, []);

  /* ----- selection actions ----- */
  const selectedObjects = useMemo(() => {
    const ids = new Set(liveEditor.selectedIds);
    return page?.objects.filter((o) => ids.has(o.id)) ?? [];
  }, [liveEditor.selectedIds, page?.objects]);

  const deleteSelection = useCallback(() => {
    if (!page || selectedObjects.length === 0) return;
    dispatch({ type: "commit", pageId: page.id, changes: selectedObjects.map((o) => ({ before: o, after: null })) });
    setEditor((e) => ({ ...e, selectedIds: [], region: null }));
  }, [page, selectedObjects]);

  const duplicateSelection = useCallback(() => {
    if (!page || selectedObjects.length === 0) return;
    const maxZ = page.objects.reduce((m, o) => Math.max(m, o.zIndex), 0);
    const copies = selectedObjects.map((o, i) => ({ ...o, id: newId(), x: o.x + 16, y: o.y + 16, zIndex: maxZ + 1 + i, linkedToId: null }));
    dispatch({ type: "commit", pageId: page.id, changes: copies.map((c) => ({ before: null, after: c })) });
    setEditor((e) => ({ ...e, selectedIds: copies.map((c) => c.id), region: null }));
  }, [page, selectedObjects]);

  /* ----- keyboard shortcuts ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (mod && k === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && k === "a" && page) {
        e.preventDefault();
        setEditor((ed) => ({ ...ed, tool: "select", selectedIds: page.objects.map((o) => o.id), region: null }));
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        setEditor((ed) => ({ ...ed, selectedIds: [], region: null }));
      } else if (!mod && !e.altKey && TOOL_SHORTCUTS[k]) {
        setEditor((ed) => ({ ...ed, tool: TOOL_SHORTCUTS[k]!, ...(TOOL_SHORTCUTS[k] === "select" || TOOL_SHORTCUTS[k] === "lasso" ? {} : { selectedIds: [], region: null }) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, deleteSelection, duplicateSelection]);

  const rename = async (next: string) => {
    const prev = title;
    setTitle(next);
    try {
      await api.updateNotebook(notebook.id, { title: next });
    } catch (e) {
      setTitle(prev);
      showError(e instanceof Error ? e.message : "Could not rename notebook");
    }
  };

  if (!page) return null;

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <TopBar
        title={title}
        onRename={rename}
        pageIndex={pageIndex}
        pageCount={state.pages.length}
        onPrev={() => goToPage(state.pages[pageIndex - 1]!.id)}
        onNext={() => goToPage(state.pages[pageIndex + 1]!.id)}
        status={status}
        onRetrySave={() => void flush()}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        notice={notice}
        onExport={exportPdf}
        exporting={exporting}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((o) => !o)}
        graphOpen={graphOpen}
        onToggleGraph={() => setGraphOpen((o) => !o)}
      />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <Sidebar notebookId={notebook.id} pages={state.pages} currentPageId={state.currentPageId} dispatch={(a) => (a.type === "setPage" ? goToPage(a.pageId) : dispatch(a))} onError={showError} onImportPdf={importPdf} importing={importing} />
        )}
        <main className="relative min-w-0 flex-1">
          <div ref={scrollRef} className="absolute inset-0 overflow-auto" data-testid="canvas-scroll">
            <div className="flex min-h-full w-max min-w-full justify-center px-6 pb-28 pt-20">
              <PageCanvas
                key={page.id}
                page={page}
                editor={liveEditor}
                patchEditor={patchEditor}
                onCommit={onCommit}
                scrollRef={scrollRef}
                onDuplicate={duplicateSelection}
                onDeleteSelection={deleteSelection}
                onAskAi={askAi}
                onMeasure={onMeasure}
              />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <DrawingToolbar
              isPdfPage={isPdfPage}
              editor={liveEditor}
              patchEditor={patchEditor}
              canUndo={state.undoStack.length > 0}
              canRedo={state.redoStack.length > 0}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
            />
          </div>
          <div className="pointer-events-none absolute bottom-4 right-6">
            <ZoomControls zoom={editor.zoom} onZoom={setZoom} onFit={fit} />
          </div>
          {textSelection && selectionAnchor && editor.tool === "textselect" && !aiOpen && (
            <button
              data-testid="ask-ai-text"
              onMouseDown={(e) => e.preventDefault()}
              onClick={askAi}
              className="fixed z-20 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-accent/90"
              style={{ left: Math.min(selectionAnchor.x + 6, window.innerWidth - 110), top: Math.max(8, selectionAnchor.y - 38) }}
            >
              <Sparkles size={13} /> Ask AI
            </button>
          )}
          {toast && (
            <div role="alert" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-sm text-white shadow-lg">
              {toast}
            </div>
          )}
        </main>
        {graphOpen && (
          <GraphPanel
            page={page}
            onClose={() => setGraphOpen(false)}
            onInsertGraph={insertGraph}
          />
        )}
        {aiOpen && (
          <AiPanel
            notebookId={notebook.id}
            page={page}
            pageCount={state.pages.length}
            editor={liveEditor}
            textSelection={editor.tool === "textselect" ? textSelection : ""}
            onClearSelection={clearAiSelection}
            onGoToPageNumber={(n) => {
              const target = state.pages[n - 1];
              if (target) goToPage(target.id);
            }}
            onInsertSolution={insertSolution}
            onFlushSave={flush}
            focusSignal={aiFocus}
            onClose={() => setAiOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

type DocState = DocumentDto & { scannedPages?: number[]; hasTextLayer?: boolean | null };

/** Status chip content for the document behind the current page (or any unfinished import). */
function documentNotice(docs: DocState[], currentDocId: string | null, pdfPage: number | null) {
  const processing = docs.find((d) => d.status === "UPLOADED" || d.status === "PROCESSING");
  if (processing) return { tone: "info" as const, text: "Reading PDF text…", busy: true, title: "You can keep annotating while this finishes." };
  const current = docs.find((d) => d.id === currentDocId);
  if (!current) return null;
  if (current.status === "FAILED") {
    return { tone: "warn" as const, text: "PDF text unavailable", title: `${current.statusMessage ?? "Extraction failed"}. You can still annotate this PDF.` };
  }
  if (pdfPage && current.scannedPages?.includes(pdfPage)) {
    return { tone: "info" as const, text: "Scanned page · no selectable text", title: "This page is an image, so its text cannot be selected or copied." };
  }
  return null;
}
