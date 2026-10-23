"use client";
import dynamic from "next/dynamic";
import { useMemo, useState, type RefObject } from "react";
import type { PageDto } from "@/lib/client/api";
import type { Change } from "@/lib/notebook/ops";
import type { EquationObject, NotebookObject, TextObject } from "@/lib/notebook/schemas";
import type { EditorState } from "./editor";
import { EquationEditor, TextEditor } from "./editors";
import { InteractionLayer, type Preview } from "./interaction-layer";
import { ObjectsLayer } from "./objects-layer";
import { PdfPageBackground } from "./pdf-page-background";

// Konva touches `window`/canvas at import time, so it is client-only.
const InkStage = dynamic(() => import("./ink-stage"), { ssr: false });

const BG_CLASS: Record<string, string> = { BLANK: "page-blank", RULED: "page-ruled", GRID: "page-grid", PDF: "page-blank" };

interface Props {
  page: PageDto;
  editor: EditorState;
  patchEditor: (p: Partial<EditorState>) => void;
  onCommit: (pageId: string, changes: Change[]) => void;
  scrollRef: RefObject<HTMLElement | null>;
  onDuplicate: () => void;
  onDeleteSelection: () => void;
  onAskAi?: () => void;
  onMeasure?: (id: string, height: number) => void;
}

/**
 * One page, as stacked layers (bottom to top):
 *  1. page background (CSS pattern, or the original PDF page via pdf.js) - never modified by editing
 *  2. text / equation / graph objects (DOM)
 *  3. ink + shapes (Konva, render only)
 *  4. interaction layer (all pointer input, live previews, selection frame)
 *  5. in-place editors
 */
export function PageCanvas({ page, editor, patchEditor, onCommit, scrollRef, onDuplicate, onDeleteSelection, onAskAi, onMeasure }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const zoom = editor.zoom;
  const editingId = editor.editing?.draft.id;

  const displayObjects = useMemo(() => {
    const out: NotebookObject[] = [];
    for (const o of page.objects) {
      if (preview?.hidden.has(o.id) || o.id === editingId) continue;
      out.push(preview?.overrides.get(o.id) ?? o);
    }
    return out;
  }, [page.objects, preview, editingId]);

  const finishText = (text: string, height: number) => {
    const ed = editor.editing;
    if (!ed || ed.draft.type !== "TEXT") return;
    patchEditor({ editing: null });
    const draft = ed.draft as TextObject;
    const original = ed.original as TextObject | null;
    if (text.trim() === "") {
      if (original) onCommit(page.id, [{ before: original, after: null }]);
      return;
    }
    if (original && original.data.text === text) return;
    const after: TextObject = { ...draft, height, data: { ...draft.data, text } };
    onCommit(page.id, [{ before: original, after }]);
    patchEditor({ selectedIds: [] });
  };

  const finishEquation = (latex: string, size: { width: number; height: number }) => {
    const ed = editor.editing;
    if (!ed || ed.draft.type !== "EQUATION") return;
    patchEditor({ editing: null });
    const original = ed.original as EquationObject | null;
    if (latex === "") {
      if (original) onCommit(page.id, [{ before: original, after: null }]);
      return;
    }
    if (original && original.data.latex === latex) return;
    const after: EquationObject = { ...(ed.draft as EquationObject), ...size, data: { ...(ed.draft as EquationObject).data, latex } };
    onCommit(page.id, [{ before: original, after }]);
  };

  return (
    <div
      data-testid="page-canvas"
      data-page-id={page.id}
      data-object-count={page.objects.length}
      data-ink-count={page.objects.filter((o) => o.type === "INK").length}
      className={`relative shrink-0 overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.06)] ${BG_CLASS[page.pageType]}`}
      style={{ width: page.width * zoom, height: page.height * zoom, ["--z" as string]: zoom }}
    >
      {page.pageType === "PDF" && page.documentId && page.pdfPageNumber && (
        <PdfPageBackground
          documentId={page.documentId}
          pageNumber={page.pdfPageNumber}
          width={page.width}
          height={page.height}
          zoom={zoom}
          textSelectable={editor.tool === "textselect"}
        />
      )}
      <ObjectsLayer objects={displayObjects} zoom={zoom} width={page.width} height={page.height} onMeasure={onMeasure} />
      <InkStage width={page.width} height={page.height} zoom={zoom} objects={displayObjects} />
      <InteractionLayer
        page={page}
        zoom={zoom}
        editor={editor}
        patchEditor={patchEditor}
        objects={page.objects}
        displayObjects={displayObjects}
        onCommit={(changes) => onCommit(page.id, changes)}
        setPreview={setPreview}
        scrollRef={scrollRef}
        onDuplicate={onDuplicate}
        onDeleteSelection={onDeleteSelection}
        onAskAi={onAskAi}
      />
      {editor.editing?.draft.type === "TEXT" && (
        <TextEditor key={editor.editing.draft.id} draft={editor.editing.draft as TextObject} zoom={zoom} onDone={finishText} />
      )}
      {editor.editing?.draft.type === "EQUATION" && (
        <EquationEditor
          key={editor.editing.draft.id}
          draft={editor.editing.draft as EquationObject}
          zoom={zoom}
          pageHeight={page.height}
          onDone={finishEquation}
        />
      )}
    </div>
  );
}
