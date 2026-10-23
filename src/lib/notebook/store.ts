import type { PageDto } from "@/lib/client/api";
import type { PageType, NotebookObject } from "./schemas";
import { applyChanges, invertChanges, type Change } from "./ops";

export interface HistoryEntry {
  pageId: string;
  changes: Change[];
}

export interface NotebookState {
  pages: PageDto[];
  currentPageId: string;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** pageId -> objectId -> revision at which it was last modified and not yet saved. */
  dirty: Record<string, Record<string, number>>;
  rev: number;
}

export type Action =
  | { type: "commit"; pageId: string; changes: Change[] }
  /** Update without a history entry (e.g. measured size). Still marks dirty. */
  | { type: "silent"; pageId: string; changes: Change[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setPage"; pageId: string }
  | { type: "pageAdded"; page: PageDto }
  | { type: "pagesAppended"; pages: PageDto[] }
  | { type: "pageRemoved"; pageId: string; remaining: { id: string; position: number }[] }
  | { type: "pagesReordered"; order: { id: string; position: number; pageType?: PageType }[] }
  | { type: "saved"; pageId: string; revs: Record<string, number> };

const HISTORY_LIMIT = 200;

export function initialState(pages: PageDto[], currentPageId?: string): NotebookState {
  return {
    pages,
    currentPageId: currentPageId ?? pages[0]?.id ?? "",
    undoStack: [],
    redoStack: [],
    dirty: {},
    rev: 0,
  };
}

function withChanges(state: NotebookState, pageId: string, changes: Change[]): Pick<NotebookState, "pages" | "dirty" | "rev"> {
  const rev = state.rev + 1;
  const pageDirty = { ...(state.dirty[pageId] ?? {}) };
  for (const c of changes) {
    const id = (c.after ?? c.before)?.id;
    if (id) pageDirty[id] = rev;
  }
  return {
    rev,
    dirty: { ...state.dirty, [pageId]: pageDirty },
    pages: state.pages.map((p) => (p.id === pageId ? { ...p, objects: applyChanges(p.objects, changes) } : p)),
  };
}

const effective = (changes: Change[]) => changes.filter((c) => c.before !== c.after);

export function reducer(state: NotebookState, action: Action): NotebookState {
  switch (action.type) {
    case "commit": {
      const changes = effective(action.changes);
      if (changes.length === 0) return state;
      return {
        ...state,
        ...withChanges(state, action.pageId, changes),
        undoStack: [...state.undoStack, { pageId: action.pageId, changes }].slice(-HISTORY_LIMIT),
        redoStack: [],
      };
    }
    case "silent": {
      const changes = effective(action.changes);
      if (changes.length === 0) return state;
      return { ...state, ...withChanges(state, action.pageId, changes) };
    }
    case "undo": {
      const entry = state.undoStack[state.undoStack.length - 1];
      if (!entry) return state;
      return {
        ...state,
        ...withChanges(state, entry.pageId, invertChanges(entry.changes)),
        currentPageId: entry.pageId,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, entry],
      };
    }
    case "redo": {
      const entry = state.redoStack[state.redoStack.length - 1];
      if (!entry) return state;
      return {
        ...state,
        ...withChanges(state, entry.pageId, entry.changes),
        currentPageId: entry.pageId,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, entry],
      };
    }
    case "setPage":
      return state.pages.some((p) => p.id === action.pageId) ? { ...state, currentPageId: action.pageId } : state;
    case "pageAdded": {
      const pages = [...state.pages.map((p) => (p.position >= action.page.position ? { ...p, position: p.position + 1 } : p)), action.page].sort(
        (a, b) => a.position - b.position,
      );
      return { ...state, pages, currentPageId: action.page.id };
    }
    case "pagesAppended": {
      const known = new Set(state.pages.map((p) => p.id));
      const fresh = action.pages.filter((p) => !known.has(p.id));
      if (fresh.length === 0) return state;
      return { ...state, pages: [...state.pages, ...fresh].sort((a, b) => a.position - b.position) };
    }
    case "pageRemoved": {
      const pos = new Map(action.remaining.map((r) => [r.id, r.position]));
      const pages = state.pages
        .filter((p) => p.id !== action.pageId)
        .map((p) => ({ ...p, position: pos.get(p.id) ?? p.position }))
        .sort((a, b) => a.position - b.position);
      const removedIndex = state.pages.findIndex((p) => p.id === action.pageId);
      const currentPageId =
        state.currentPageId === action.pageId ? (pages[Math.min(removedIndex, pages.length - 1)]?.id ?? "") : state.currentPageId;
      const { [action.pageId]: _gone, ...dirty } = state.dirty;
      void _gone;
      return {
        ...state,
        pages,
        currentPageId,
        dirty,
        undoStack: state.undoStack.filter((e) => e.pageId !== action.pageId),
        redoStack: state.redoStack.filter((e) => e.pageId !== action.pageId),
      };
    }
    case "pagesReordered": {
      const info = new Map(action.order.map((o) => [o.id, o]));
      const pages = state.pages
        .map((p) => {
          const o = info.get(p.id);
          return o ? { ...p, position: o.position, pageType: p.pageType === "PDF" ? p.pageType : (o.pageType ?? p.pageType) } : p;
        })
        .sort((a, b) => a.position - b.position);
      return { ...state, pages };
    }
    case "saved": {
      const pageDirty = state.dirty[action.pageId];
      if (!pageDirty) return state;
      const next: Record<string, number> = {};
      for (const [id, r] of Object.entries(pageDirty)) if (action.revs[id] !== r) next[id] = r;
      return { ...state, dirty: { ...state.dirty, [action.pageId]: next } };
    }
  }
}

export const hasDirty = (s: NotebookState) => Object.values(s.dirty).some((d) => Object.keys(d).length > 0);

export function currentPage(state: NotebookState): PageDto | undefined {
  return state.pages.find((p) => p.id === state.currentPageId);
}

/** Build the save payload for one page from its dirty set. */
export function buildSave(page: PageDto, dirtyIds: Record<string, number>): { upserts: NotebookObject[]; deletes: string[]; revs: Record<string, number> } {
  const byId = new Map(page.objects.map((o) => [o.id, o]));
  const upserts: NotebookObject[] = [];
  const deletes: string[] = [];
  for (const id of Object.keys(dirtyIds)) {
    const o = byId.get(id);
    if (o) upserts.push(o);
    else deletes.push(id);
  }
  return { upserts, deletes, revs: { ...dirtyIds } };
}
