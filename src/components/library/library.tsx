"use client";
import { BookOpen, FileUp, FolderIcon, FolderInput, FolderPlus, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { api, type FolderDto, type NotebookSummary } from "@/lib/client/api";
import { cn, timeAgo } from "@/lib/utils";

type Dlg =
  | { kind: "new-notebook" }
  | { kind: "rename-notebook"; nb: NotebookSummary }
  | { kind: "delete-notebook"; nb: NotebookSummary }
  | { kind: "new-folder" }
  | { kind: "rename-folder"; folder: FolderDto }
  | { kind: "delete-folder"; folder: FolderDto }
  | null;

export function Library() {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<NotebookSummary[] | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dlg>(null);
  const reqId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setError(null);
    try {
      const [n, f] = await Promise.all([api.listNotebooks(query.trim() || undefined, folderId), api.listFolders()]);
      if (id !== reqId.current) return; // a newer request superseded this one
      setNotebooks(n.notebooks);
      setFolders(f.folders);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : "Could not load notebooks");
    }
  }, [query, folderId]);

  useEffect(() => {
    const t = setTimeout(load, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const importPdf = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const { notebookId } = await api.importPdf(file);
      router.push(`/notebooks/${notebookId}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import the PDF");
      setImporting(false);
    }
  };

  const createNotebook = async (title: string, pageType: "BLANK" | "RULED" | "GRID") => {
    const { notebook } = await api.createNotebook({ title: title || "Untitled notebook", folderId, pageType });
    router.push(`/notebooks/${notebook.id}`);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-16 sm:px-8">
      <header className="flex flex-wrap items-center gap-3 py-6">
        <div className="mr-auto flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-white">
            <BookOpen size={18} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Math Notebook</h1>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search notebooks"
            placeholder="Search notebooks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <Button onClick={() => fileInput.current?.click()} disabled={importing} data-testid="import-pdf-library">
          {importing ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} {importing ? "Importing…" : "Import PDF"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          data-testid="import-pdf-library-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importPdf(f);
          }}
        />
        <Button variant="primary" onClick={() => setDialog({ kind: "new-notebook" })}>
          <Plus size={16} /> New notebook
        </Button>
      </header>
      {importError && (
        <div role="alert" data-testid="import-error" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>
            <strong className="font-medium">PDF import failed.</strong> {importError}
          </span>
          <button aria-label="Dismiss" onClick={() => setImportError(null)} className="text-red-800/70 hover:text-red-900">
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-8 md:flex-row">
        <nav aria-label="Subjects" className="md:w-56 md:shrink-0">
          <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            <FolderRow active={folderId === null} onClick={() => setFolderId(null)} label="All notebooks" />
            {folders.map((f) => (
              <div key={f.id} className="group relative flex">
                <FolderRow active={folderId === f.id} onClick={() => setFolderId(f.id)} label={f.name} count={f.notebookCount} />
                <Menu>
                  <MenuTrigger asChild>
                    <button
                      aria-label={`Options for ${f.name}`}
                      className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-md p-1 text-muted hover:bg-black/5 group-hover:block data-[state=open]:block"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => setDialog({ kind: "rename-folder", folder: f })}>
                      <Pencil size={14} /> Rename
                    </MenuItem>
                    <MenuItem danger onSelect={() => setDialog({ kind: "delete-folder", folder: f })}>
                      <Trash2 size={14} /> Delete subject
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            ))}
            <button
              onClick={() => setDialog({ kind: "new-folder" })}
              className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-black/5"
            >
              <FolderPlus size={16} /> New subject
            </button>
          </div>
        </nav>

        <main className="min-w-0 flex-1" aria-live="polite">
          {error ? (
            <div role="alert" className="rounded-2xl border border-line bg-white p-8 text-center">
              <p className="font-medium">Couldn’t load your notebooks</p>
              <p className="mt-1 text-sm text-muted">{error}</p>
              <Button className="mt-4" onClick={load}>
                Try again
              </Button>
            </div>
          ) : notebooks === null ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-48 animate-pulse rounded-2xl bg-black/5" />
              ))}
            </div>
          ) : notebooks.length === 0 ? (
            <EmptyState searching={!!query.trim()} inFolder={!!folderId} onCreate={() => setDialog({ kind: "new-notebook" })} />
          ) : (
            <>
              <h2 className="mb-3 text-sm font-medium text-muted">{query ? "Results" : "Recent"}</h2>
              <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                {notebooks.map((nb) => (
                  <NotebookCard
                    key={nb.id}
                    nb={nb}
                    folders={folders}
                    onRename={() => setDialog({ kind: "rename-notebook", nb })}
                    onDelete={() => setDialog({ kind: "delete-notebook", nb })}
                    onMove={async (fid) => {
                      await api.updateNotebook(nb.id, { folderId: fid });
                      load();
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </main>
      </div>

      <Dialogs dialog={dialog} close={() => setDialog(null)} onChanged={load} createNotebook={createNotebook} />
    </div>
  );
}

function FolderRow({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 pr-8 text-left text-sm",
        active ? "bg-white font-medium shadow-sm ring-1 ring-line" : "text-ink/80 hover:bg-black/5",
      )}
    >
      <FolderIcon size={16} className="shrink-0 text-muted" />
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="ml-auto text-xs text-muted">{count}</span>}
    </button>
  );
}

function NotebookCard({
  nb,
  folders,
  onRename,
  onDelete,
  onMove,
}: {
  nb: NotebookSummary;
  folders: FolderDto[];
  onRename: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const doc = nb.documents[0];
  const processing = doc && (doc.status === "UPLOADED" || doc.status === "PROCESSING");
  return (
    <li className="group relative">
      <Link
        href={`/notebooks/${nb.id}`}
        className="block overflow-hidden rounded-2xl border border-line bg-white transition-shadow hover:shadow-md"
      >
        <div className="grid h-32 place-items-center bg-[repeating-linear-gradient(to_bottom,#fff_0,#fff_19px,#e7ebf6_19px,#e7ebf6_20px)] text-4xl font-semibold text-ink/20">
          {nb.title.slice(0, 1).toUpperCase()}
        </div>
        <div className="border-t border-line p-3">
          <p className="truncate font-medium">{nb.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {nb._count.pages} {nb._count.pages === 1 ? "page" : "pages"} · {timeAgo(nb.lastOpenedAt)}
          </p>
          {doc && (
            <p className={cn("mt-1 text-xs", doc.status === "FAILED" ? "text-danger" : "text-muted")}>
              PDF: {processing ? "processing…" : doc.status === "FAILED" ? (doc.statusMessage ?? "failed") : "ready"}
            </p>
          )}
        </div>
      </Link>
      <Menu>
        <MenuTrigger asChild>
          <button
            aria-label={`Options for ${nb.title}`}
            className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 text-muted opacity-0 shadow-sm ring-1 ring-line hover:text-ink focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal size={16} />
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onRename}>
            <Pencil size={14} /> Rename
          </MenuItem>
          {folders.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>Move to</MenuLabel>
              <MenuItem onSelect={() => onMove(null)}>
                <FolderInput size={14} /> No subject
              </MenuItem>
              {folders.map((f) => (
                <MenuItem key={f.id} onSelect={() => onMove(f.id)} disabled={f.id === nb.folderId}>
                  <FolderIcon size={14} /> {f.name}
                </MenuItem>
              ))}
            </>
          )}
          <MenuSeparator />
          <MenuItem danger onSelect={onDelete}>
            <Trash2 size={14} /> Delete
          </MenuItem>
        </MenuContent>
      </Menu>
    </li>
  );
}

function EmptyState({ searching, inFolder, onCreate }: { searching: boolean; inFolder: boolean; onCreate: () => void }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-white px-6 py-20 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <BookOpen size={22} />
      </div>
      {searching ? (
        <>
          <p className="font-medium">No notebooks match your search</p>
          <p className="mt-1 text-sm text-muted">Try a different title.</p>
        </>
      ) : (
        <>
          <p className="font-medium">{inFolder ? "Nothing in this subject yet" : "Start your first notebook"}</p>
          <p className="mt-1 max-w-sm text-sm text-muted">Write equations, draw diagrams and keep all your maths in one place.</p>
          <Button variant="primary" className="mt-5" onClick={onCreate}>
            <Plus size={16} /> New notebook
          </Button>
          <p className="mt-3 text-xs text-muted">or use “Import PDF” above to work on an existing worksheet.</p>
        </>
      )}
    </div>
  );
}

function NameForm({
  initial,
  submitLabel,
  onSubmit,
  extra,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  extra?: React.ReactNode;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await onSubmit(name.trim());
        } catch (x) {
          setErr(x instanceof Error ? x.message : "Something went wrong");
          setBusy(false);
        }
      }}
    >
      <input
        autoFocus
        aria-label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        className="h-10 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-accent"
      />
      {extra}
      {err && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {err}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <DialogClose asChild>
          <Button>Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={busy || (!name.trim() && submitLabel !== "Create")}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Dialogs({
  dialog,
  close,
  onChanged,
  createNotebook,
}: {
  dialog: Dlg;
  close: () => void;
  onChanged: () => void;
  createNotebook: (title: string, type: "BLANK" | "RULED" | "GRID") => Promise<void>;
}) {
  const [pageType, setPageType] = useState<"BLANK" | "RULED" | "GRID">("RULED");
  const done = async () => {
    close();
    onChanged();
  };
  return (
    <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
      {dialog?.kind === "new-notebook" && (
        <DialogContent title="New notebook">
          <NameForm
            initial=""
            submitLabel="Create"
            onSubmit={(n) => createNotebook(n, pageType)}
            extra={
              <fieldset className="mt-4">
                <legend className="mb-1.5 text-sm text-muted">Page style</legend>
                <div className="flex gap-2">
                  {(["BLANK", "RULED", "GRID"] as const).map((t) => (
                    <label
                      key={t}
                      className={cn(
                        "flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm",
                        pageType === t ? "border-accent bg-accent-soft font-medium" : "border-line hover:bg-surface",
                      )}
                    >
                      <input type="radio" name="pt" className="sr-only" checked={pageType === t} onChange={() => setPageType(t)} />
                      {t[0] + t.slice(1).toLowerCase()}
                    </label>
                  ))}
                </div>
              </fieldset>
            }
          />
        </DialogContent>
      )}
      {dialog?.kind === "rename-notebook" && (
        <DialogContent title="Rename notebook">
          <NameForm initial={dialog.nb.title} submitLabel="Rename" onSubmit={async (n) => { await api.updateNotebook(dialog.nb.id, { title: n }); await done(); }} />
        </DialogContent>
      )}
      {dialog?.kind === "delete-notebook" && (
        <DialogContent title="Delete notebook?" description={`“${dialog.nb.title}” and all of its pages will be permanently deleted.`}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="danger" onClick={async () => { await api.deleteNotebook(dialog.nb.id); await done(); }}>
              Delete
            </Button>
          </div>
        </DialogContent>
      )}
      {dialog?.kind === "new-folder" && (
        <DialogContent title="New subject">
          <NameForm initial="" submitLabel="Create" onSubmit={async (n) => { if (n) await api.createFolder(n); await done(); }} />
        </DialogContent>
      )}
      {dialog?.kind === "rename-folder" && (
        <DialogContent title="Rename subject">
          <NameForm initial={dialog.folder.name} submitLabel="Rename" onSubmit={async (n) => { await api.renameFolder(dialog.folder.id, n); await done(); }} />
        </DialogContent>
      )}
      {dialog?.kind === "delete-folder" && (
        <DialogContent title="Delete subject?" description={`Notebooks in “${dialog.folder.name}” are kept and move to All notebooks.`}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="danger" onClick={async () => { await api.deleteFolder(dialog.folder.id); await done(); }}>
              Delete
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
