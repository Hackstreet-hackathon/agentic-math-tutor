"use client";
import { AlertTriangle, ChevronLeft, ChevronRight, CloudCheck, Download, Loader2, PanelLeft, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "./use-autosave";

export function TopBar({
  title,
  onRename,
  pageIndex,
  pageCount,
  onPrev,
  onNext,
  status,
  onRetrySave,
  sidebarOpen,
  onToggleSidebar,
  notice,
  onExport,
  exporting,
  aiOpen,
  onToggleAi,
}: {
  title: string;
  onRename: (title: string) => void;
  pageIndex: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  status: SaveStatus;
  onRetrySave: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onExport: () => void;
  exporting: boolean;
  aiOpen: boolean;
  onToggleAi: () => void;
  notice?: { tone: "info" | "warn"; text: string; busy?: boolean; title?: string } | null;
}) {
  // null = not editing; show the committed title.
  const [edit, setEdit] = useState<string | null>(null);
  const draft = edit ?? title;
  const setDraft = (v: string | null) => setEdit(v);

  const commit = () => {
    const t = draft.trim();
    setDraft(null);
    if (t && t !== title) onRename(t);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-white px-2">
      <Tip label="Back to library">
        <Link href="/" aria-label="Back to library" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-black/5">
          <ChevronLeft size={18} />
        </Link>
      </Tip>
      <Tip label={sidebarOpen ? "Hide pages" : "Show pages"}>
        <button
          aria-label={sidebarOpen ? "Hide pages" : "Show pages"}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
          className={cn("grid h-9 w-9 place-items-center rounded-lg hover:bg-black/5", sidebarOpen && "bg-black/5")}
        >
          <PanelLeft size={18} />
        </button>
      </Tip>
      <input
        aria-label="Notebook title"
        data-testid="notebook-title"
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-9 min-w-0 max-w-xs flex-1 truncate rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold hover:border-line focus:border-accent focus:bg-white"
      />

      <div className="mx-auto flex items-center gap-1" role="group" aria-label="Page navigation">
        <button aria-label="Previous page" disabled={pageIndex <= 0} onClick={onPrev} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-30">
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-14 text-center text-sm tabular-nums" data-testid="page-indicator" aria-live="polite">
          {pageIndex + 1} / {pageCount}
        </span>
        <button aria-label="Next page" disabled={pageIndex >= pageCount - 1} onClick={onNext} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
      </div>

      {notice && (
        <span
          role="status"
          title={notice.title}
          data-testid="document-notice"
          className={cn("hidden items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs sm:flex", notice.tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-black/5 text-muted")}
        >
          {notice.busy ? <Loader2 size={12} className="animate-spin" /> : notice.tone === "warn" ? <AlertTriangle size={12} /> : null}
          {notice.text}
        </span>
      )}
      <SaveIndicator status={status} onRetry={onRetrySave} />
      <Tip label={aiOpen ? "Hide AI tutor" : "Open AI tutor"}>
        <button
          onClick={onToggleAi}
          aria-pressed={aiOpen}
          data-testid="toggle-ai"
          className={cn("flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm", aiOpen ? "border-accent bg-accent-soft text-accent" : "border-line bg-white hover:bg-surface")}
        >
          <Sparkles size={15} />
          <span className="hidden sm:inline">AI tutor</span>
        </button>
      </Tip>
      <Tip label="Download as PDF (originals stay untouched)">
        <button
          onClick={onExport}
          disabled={exporting}
          data-testid="export-pdf"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm hover:bg-surface disabled:opacity-60"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          <span className="hidden sm:inline">{exporting ? "Preparing…" : "Export"}</span>
        </button>
      </Tip>
    </header>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const base = "flex items-center gap-1.5 whitespace-nowrap px-2 text-xs";
  if (status === "error")
    return (
      <button onClick={onRetry} className={cn(base, "text-danger")} role="status" data-testid="save-status">
        <AlertTriangle size={14} /> Save failed · Retry
      </button>
    );
  if (status === "saving")
    return (
      <span className={cn(base, "text-muted")} role="status" data-testid="save-status">
        <Loader2 size={14} className="animate-spin" /> Saving…
      </span>
    );
  if (status === "unsaved")
    return (
      <span className={cn(base, "text-muted")} role="status" data-testid="save-status">
        Unsaved changes
      </span>
    );
  return (
    <span className={cn(base, "text-muted")} role="status" data-testid="save-status">
      <CloudCheck size={14} /> Saved
    </span>
  );
}

export function ZoomControls({ zoom, onZoom, onFit }: { zoom: number; onZoom: (z: number) => void; onFit: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center rounded-xl border border-line bg-white/95 p-0.5 shadow-md backdrop-blur" role="group" aria-label="Zoom">
      <button aria-label="Zoom out" onClick={() => onZoom(zoom / 1.15)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5">
        <ZoomOut size={16} />
      </button>
      <button onClick={onFit} aria-label="Fit page to width" className="min-w-12 rounded-lg px-1 text-xs tabular-nums hover:bg-black/5" data-testid="zoom-level">
        {Math.round(zoom * 100)}%
      </button>
      <button aria-label="Zoom in" onClick={() => onZoom(zoom * 1.15)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5">
        <ZoomIn size={16} />
      </button>
    </div>
  );
}
