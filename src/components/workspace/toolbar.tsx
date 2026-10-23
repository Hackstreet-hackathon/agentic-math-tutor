"use client";
import * as Popover from "@radix-ui/react-popover";
import {
  Circle,
  Eraser,
  Highlighter,
  LassoSelect,
  MousePointer2,
  MoveUpRight,
  Pen,
  Pencil,
  Redo2,
  Shapes,
  Sigma,
  TextSelect,
  Square,
  Minus,
  Type,
  Undo2,
} from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { COLORS, type EditorState, type ShapeKind, type Tool } from "./editor";

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select", key: "V", icon: <MousePointer2 size={18} /> },
  { tool: "textselect", label: "Select PDF text", key: "I", icon: <TextSelect size={18} /> },
  { tool: "pen", label: "Pen", key: "P", icon: <Pen size={18} /> },
  { tool: "pencil", label: "Pencil", key: "C", icon: <Pencil size={18} /> },
  { tool: "highlighter", label: "Highlighter", key: "H", icon: <Highlighter size={18} /> },
  { tool: "eraser", label: "Eraser", key: "E", icon: <Eraser size={18} /> },
  { tool: "lasso", label: "Lasso / circle selection", key: "L", icon: <LassoSelect size={18} /> },
  { tool: "shape", label: "Shapes", key: "S", icon: <Shapes size={18} /> },
  { tool: "text", label: "Text", key: "T", icon: <Type size={18} /> },
  { tool: "equation", label: "Equation", key: "M", icon: <Sigma size={18} /> },
];

export const TOOL_SHORTCUTS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

const SHAPES: { kind: ShapeKind; label: string; icon: React.ReactNode }[] = [
  { kind: "ellipse", label: "Ellipse", icon: <Circle size={16} /> },
  { kind: "rect", label: "Rectangle", icon: <Square size={16} /> },
  { kind: "line", label: "Line", icon: <Minus size={16} /> },
  { kind: "arrow", label: "Arrow", icon: <MoveUpRight size={16} /> },
];

type SizeKey = keyof EditorState["sizes"];
const sizeKeyFor = (t: Tool): SizeKey | null =>
  t === "pen" || t === "pencil" || t === "highlighter" || t === "eraser" || t === "shape" ? t : null;

export function DrawingToolbar({
  isPdfPage,
  editor,
  patchEditor,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  /** PDF-only tools (text selection) are offered on PDF pages. */
  isPdfPage: boolean;
  editor: EditorState;
  patchEditor: (p: Partial<EditorState>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const sizeKey = sizeKeyFor(editor.tool);
  const usesColor = editor.tool !== "eraser" && editor.tool !== "select" && editor.tool !== "lasso" && editor.tool !== "textselect";
  const sizeRange = editor.tool === "eraser" ? { min: 6, max: 60 } : { min: 1, max: 24 };

  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border border-line bg-white/95 p-1 shadow-md backdrop-blur"
    >
      {TOOLS.filter((t) => t.tool !== "textselect" || isPdfPage).map((t) => (
        <Tip key={t.tool} label={`${t.label} (${t.key})`}>
          <button
            aria-label={t.label}
            aria-pressed={editor.tool === t.tool}
            data-testid={`tool-${t.tool}`}
            onClick={() => patchEditor({ tool: t.tool, ...(t.tool === "select" || t.tool === "lasso" ? {} : { selectedIds: [], region: null }) })}
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors",
              editor.tool === t.tool ? "bg-ink text-white" : "text-ink hover:bg-black/5",
            )}
          >
            {t.icon}
          </button>
        </Tip>
      ))}

      <Sep />

      <Popover.Root>
        <Tip label="Colour, size and shape">
          <Popover.Trigger asChild>
            <button
              aria-label="Stroke style"
              data-testid="style-trigger"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 hover:bg-black/5"
            >
              <span className="h-5 w-5 rounded-full border border-black/15" style={{ background: usesColor ? editor.color : "#fff" }} />
              {sizeKey && <span className="text-xs tabular-nums text-muted">{editor.sizes[sizeKey]}</span>}
            </button>
          </Popover.Trigger>
        </Tip>
        <Popover.Portal>
          <Popover.Content
            sideOffset={8}
            className="z-50 w-64 rounded-2xl border border-line bg-white p-4 shadow-xl"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {usesColor && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-medium text-muted">Colour</p>
                <div className="flex flex-wrap items-center gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      aria-label={`Colour ${c}`}
                      aria-pressed={editor.color === c}
                      onClick={() => patchEditor({ color: c })}
                      className={cn("h-7 w-7 rounded-full border border-black/10", editor.color === c && "ring-2 ring-accent ring-offset-2")}
                      style={{ background: c }}
                    />
                  ))}
                  <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted" title="Custom colour">
                    <input
                      type="color"
                      aria-label="Custom colour"
                      value={editor.color}
                      onChange={(e) => patchEditor({ color: e.target.value })}
                      className="absolute -inset-2 h-12 w-12 cursor-pointer opacity-0"
                    />
                  </label>
                </div>
              </div>
            )}
            {sizeKey && (
              <div className="mb-1">
                <label className="mb-2 flex justify-between text-xs font-medium text-muted" htmlFor="size-range">
                  <span>{editor.tool === "eraser" ? "Eraser size" : "Thickness"}</span>
                  <span className="tabular-nums">{editor.sizes[sizeKey]}</span>
                </label>
                <input
                  id="size-range"
                  type="range"
                  {...sizeRange}
                  value={editor.sizes[sizeKey]}
                  onChange={(e) => patchEditor({ sizes: { ...editor.sizes, [sizeKey]: Number(e.target.value) } })}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            )}
            {editor.tool === "shape" && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-muted">Shape</p>
                <div className="flex gap-1">
                  {SHAPES.map((s) => (
                    <button
                      key={s.kind}
                      aria-label={s.label}
                      aria-pressed={editor.shapeKind === s.kind}
                      onClick={() => patchEditor({ shapeKind: s.kind })}
                      className={cn("grid h-9 flex-1 place-items-center rounded-lg border", editor.shapeKind === s.kind ? "border-accent bg-accent-soft" : "border-line hover:bg-surface")}
                    >
                      {s.icon}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!usesColor && !sizeKey && <p className="text-sm text-muted">This tool has no style options.</p>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Sep />

      <Tip label="Undo (Ctrl+Z)">
        <button aria-label="Undo" disabled={!canUndo} onClick={onUndo} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl hover:bg-black/5 disabled:opacity-30">
          <Undo2 size={18} />
        </button>
      </Tip>
      <Tip label="Redo (Ctrl+Shift+Z)">
        <button aria-label="Redo" disabled={!canRedo} onClick={onRedo} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl hover:bg-black/5 disabled:opacity-30">
          <Redo2 size={18} />
        </button>
      </Tip>
    </div>
  );
}

const Sep = () => <div className="mx-1 h-6 w-px shrink-0 bg-line" />;
