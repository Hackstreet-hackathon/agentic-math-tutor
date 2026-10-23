"use client";
import { ArrowDown, ArrowUp, FilePlus2, FileText, Grid3x3, Loader2, MoreHorizontal, Plus, Rows3, Square, Trash2 } from "lucide-react";
import { useRef, useState, type Dispatch } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { api, type PageDto } from "@/lib/client/api";
import type { Action } from "@/lib/notebook/store";
import { cn } from "@/lib/utils";
import { PageThumb } from "./page-thumb";
import { PdfThumb } from "./pdf-thumb";

export function Sidebar({
  notebookId,
  pages,
  currentPageId,
  dispatch,
  onError,
  onImportPdf,
  importing,
}: {
  notebookId: string;
  pages: PageDto[];
  currentPageId: string;
  dispatch: Dispatch<Action>;
  onError: (message: string) => void;
  onImportPdf: (file: File) => void;
  importing: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PageDto | null>(null);
  const current = pages.find((p) => p.id === currentPageId);

  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const addPage = () =>
    guard(async () => {
      const { page } = await api.addPage(notebookId, { afterPosition: current?.position ?? pages.length - 1 });
      dispatch({ type: "pageAdded", page });
    });

  const move = (page: PageDto, position: number) =>
    guard(async () => {
      if (position === page.position || position < 0 || position >= pages.length) return;
      const { pages: order } = await api.updatePage(page.id, { position });
      dispatch({ type: "pagesReordered", order });
    });

  const setType = (page: PageDto, pageType: "BLANK" | "RULED" | "GRID") =>
    guard(async () => {
      const { pages: order } = await api.updatePage(page.id, { pageType });
      dispatch({ type: "pagesReordered", order });
    });

  const remove = (page: PageDto) =>
    guard(async () => {
      const { pages: remaining } = await api.deletePage(page.id);
      dispatch({ type: "pageRemoved", pageId: page.id, remaining });
    });

  return (
    <aside aria-label="Pages" className="flex w-44 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Pages</span>
        <div className="flex items-center">
          <Button size="sm" variant="ghost" onClick={addPage} aria-label="Add page" data-testid="add-page" className="h-7 px-2">
            <Plus size={14} /> Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
            disabled={importing}
            aria-label="Import PDF into this notebook"
            title="Import PDF"
            data-testid="import-pdf"
            className="h-7 px-1.5"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            data-testid="import-pdf-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onImportPdf(f);
            }}
          />
        </div>
      </div>
      <ol className="flex-1 space-y-3 overflow-y-auto px-3 pb-4">
        {pages.map((p, i) => (
          <li
            key={p.id}
            draggable
            onDragStart={() => setDragId(p.id)}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverId(p.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const dragged = pages.find((x) => x.id === dragId);
              if (dragged) void move(dragged, p.position);
              setDragId(null);
              setOverId(null);
            }}
            className={cn("group relative", overId === p.id && dragId !== p.id && "before:absolute before:-top-2 before:left-0 before:h-0.5 before:w-full before:bg-accent")}
          >
            <button
              onClick={() => dispatch({ type: "setPage", pageId: p.id })}
              aria-label={`Page ${i + 1}`}
              aria-current={p.id === currentPageId ? "page" : undefined}
              data-testid={`page-thumb-${i + 1}`}
              className={cn(
                "relative block w-full overflow-hidden rounded-md border bg-white shadow-sm transition",
                p.id === currentPageId ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-muted",
              )}
            >
              <div style={{ aspectRatio: `${p.width} / ${p.height}` }} className="relative w-full">
                {p.pageType === "PDF" && p.documentId && p.pdfPageNumber ? (
                  <>
                    <PdfThumb documentId={p.documentId} pageNumber={p.pdfPageNumber} width={140} />
                    <div className="absolute inset-0">
                      <PageThumb page={p} transparent />
                    </div>
                  </>
                ) : (
                  <PageThumb page={p} />
                )}
              </div>
            </button>
            <div className="mt-1 flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-1">
                {p.pageType === "PDF" && <FileText size={11} />}
                {p.pageType === "PDF" && p.pdfPageNumber ? `${i + 1} · PDF p.${p.pdfPageNumber}` : i + 1}
              </span>
              <Menu>
                <MenuTrigger asChild>
                  <button aria-label={`Options for page ${i + 1}`} className="rounded p-0.5 opacity-0 hover:bg-black/5 focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal size={14} />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  {p.pageType !== "PDF" && (
                    <>
                      <MenuLabel>Background</MenuLabel>
                      <MenuItem onSelect={() => setType(p, "BLANK")}>
                        <Square size={14} /> Blank
                      </MenuItem>
                      <MenuItem onSelect={() => setType(p, "RULED")}>
                        <Rows3 size={14} /> Ruled
                      </MenuItem>
                      <MenuItem onSelect={() => setType(p, "GRID")}>
                        <Grid3x3 size={14} /> Grid
                      </MenuItem>
                      <MenuSeparator />
                    </>
                  )}
                  <MenuItem disabled={i === 0} onSelect={() => move(p, p.position - 1)}>
                    <ArrowUp size={14} /> Move up
                  </MenuItem>
                  <MenuItem disabled={i === pages.length - 1} onSelect={() => move(p, p.position + 1)}>
                    <ArrowDown size={14} /> Move down
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    disabled={pages.length <= 1}
                    onSelect={() => (p.objects.length > 0 ? setConfirmDelete(p) : remove(p))}
                  >
                    <Trash2 size={14} /> Delete page
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </li>
        ))}
      </ol>

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        {confirmDelete && (
          <DialogContent title="Delete this page?" description="Everything on this page will be removed.">
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                onClick={async () => {
                  const p = confirmDelete;
                  setConfirmDelete(null);
                  await remove(p);
                }}
              >
                Delete page
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </aside>
  );
}
