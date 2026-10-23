import type { NotebookObject, PageType, SaveObjectsInput } from "@/lib/notebook/schemas";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.", "network");
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`, body?.error?.code);
  return body as T;
}

const send = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface FolderDto {
  id: string;
  name: string;
  color: string | null;
  notebookCount: number;
}
export interface DocumentDto {
  id: string;
  originalName: string;
  status: "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
  statusMessage: string | null;
  pageCount: number;
}
export interface NotebookSummary {
  id: string;
  title: string;
  folderId: string | null;
  lastOpenedAt: string;
  updatedAt: string;
  defaultPageType: PageType;
  _count: { pages: number };
  documents: DocumentDto[];
}
export interface PageDto {
  id: string;
  position: number;
  pageType: PageType;
  width: number;
  height: number;
  documentId: string | null;
  pdfPageNumber: number | null;
  objects: NotebookObject[];
}
export interface NotebookDto {
  id: string;
  title: string;
  folderId: string | null;
  defaultPageType: PageType;
  documents: (DocumentDto & { scannedPages?: number[] })[];
  pages: PageDto[];
}

export const api = {
  listNotebooks: (q?: string, folderId?: string | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (folderId) p.set("folderId", folderId);
    return request<{ notebooks: NotebookSummary[] }>(`/api/notebooks?${p}`);
  },
  createNotebook: (input: { title: string; folderId?: string | null; pageType?: "BLANK" | "RULED" | "GRID" }) =>
    request<{ notebook: { id: string; title: string } }>("/api/notebooks", send("POST", input)),
  getNotebook: (id: string) => request<{ notebook: NotebookDto }>(`/api/notebooks/${id}`),
  updateNotebook: (id: string, input: { title?: string; folderId?: string | null }) =>
    request<{ notebook: { id: string; title: string } }>(`/api/notebooks/${id}`, send("PATCH", input)),
  deleteNotebook: (id: string) => request<{ ok: true }>(`/api/notebooks/${id}`, send("DELETE")),

  listFolders: () => request<{ folders: FolderDto[] }>("/api/folders"),
  createFolder: (name: string) => request<{ folder: FolderDto }>("/api/folders", send("POST", { name })),
  renameFolder: (id: string, name: string) => request<{ folder: FolderDto }>(`/api/folders/${id}`, send("PATCH", { name })),
  deleteFolder: (id: string) => request<{ ok: true }>(`/api/folders/${id}`, send("DELETE")),

  importPdf: (file: File, notebookId?: string) => {
    const form = new FormData();
    form.set("file", file);
    if (notebookId) form.set("notebookId", notebookId);
    return request<{ notebookId: string; document: DocumentDto }>("/api/documents", { method: "POST", body: form });
  },
  getDocument: (id: string) => request<{ document: DocumentDto & { scannedPages: number[]; hasTextLayer: boolean | null } }>(`/api/documents/${id}`),

  addPage: (notebookId: string, input: { pageType?: "BLANK" | "RULED" | "GRID"; afterPosition?: number }) =>
    request<{ page: PageDto }>(`/api/notebooks/${notebookId}/pages`, send("POST", input)),
  updatePage: (pageId: string, input: { pageType?: "BLANK" | "RULED" | "GRID"; position?: number }) =>
    request<{ pages: { id: string; position: number; pageType: PageType }[] }>(`/api/pages/${pageId}`, send("PATCH", input)),
  deletePage: (pageId: string) => request<{ pages: { id: string; position: number }[] }>(`/api/pages/${pageId}`, send("DELETE")),
  saveObjects: (pageId: string, input: SaveObjectsInput, keepalive = false) =>
    request<{ ok: true; savedAt: string }>(`/api/pages/${pageId}/objects`, { ...send("PUT", input), keepalive }),
};
