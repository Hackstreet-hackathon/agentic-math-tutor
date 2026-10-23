"use client";
import { Copy, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PageDto } from "@/lib/client/api";
import { clamp, normaliseRect, rectsIntersect, type Point, type Rect } from "@/lib/notebook/geometry";
import {
  boundsOfObjects,
  hitsObject,
  inkStyleFor,
  makeInk,
  moveObject,
  nextZ,
  objectsInLasso,
  pickTop,
  resizeBounds,
  strokePathData,
  transformObject,
  type Change,
  type Handle,
  type InkStyle,
} from "@/lib/notebook/ops";
import type { EquationObject, NotebookObject, ShapeObject, TextObject } from "@/lib/notebook/schemas";
import { isPenDetected, markPenDetected } from "@/lib/client/device";
import { cn, newId } from "@/lib/utils";
import { DRAWING_TOOLS, type EditorState } from "./editor";

export interface Preview {
  overrides: Map<string, NotebookObject>;
  hidden: Set<string>;
}

interface Props {
  page: PageDto;
  zoom: number;
  editor: EditorState;
  patchEditor: (p: Partial<EditorState>) => void;
  /** Committed objects for hit-testing (no previews applied). */
  objects: NotebookObject[];
  /** Objects as currently displayed (previews applied) for the selection frame. */
  displayObjects: NotebookObject[];
  onCommit: (changes: Change[]) => void;
  setPreview: (p: Preview | null) => void;
  scrollRef: RefObject<HTMLElement | null>;
  onDuplicate: () => void;
  onDeleteSelection: () => void;
  /** Opens the AI tutor with the current selection attached. Explicit action: circling never calls the AI by itself. */
  onAskAi?: () => void;
}

type Gesture =
  | { kind: "stroke"; pid: number; pts: Point[]; pressures: number[]; times: number[]; t0: number; style: InkStyle; pen: boolean }
  | { kind: "erase"; pid: number; erased: Set<string>; last: Point }
  | { kind: "move"; pid: number; start: Point; originals: NotebookObject[]; moved: boolean }
  | { kind: "resize"; pid: number; handle: Handle; startBounds: Rect; originals: NotebookObject[] }
  | { kind: "marquee"; pid: number; start: Point; additive: boolean; base: string[] }
  | { kind: "lasso"; pid: number; pts: Point[] }
  | { kind: "shape"; pid: number; start: Point }
  | { kind: "pan"; pid: number; x: number; y: number };

const HANDLE_SIZE = 10;
const TOUCH_TOLERANCE = 8;

export function InteractionLayer(props: Props) {
  const { page, zoom, editor, objects, displayObjects, onCommit, setPreview, scrollRef, patchEditor } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const liveStroke = useRef<SVGPathElement>(null);
  const liveLasso = useRef<SVGPathElement>(null);
  const eraserCursor = useRef<SVGCircleElement>(null);
  const raf = useRef(0);
  const [liveBox, setLiveBox] = useState<{ kind: "marquee" | "shape"; rect: Rect; shape?: string; flip?: [boolean, boolean] } | null>(null);

  // Always read the freshest props from gesture handlers without re-binding.
  const latest = useRef({ editor, objects, zoom });
  useEffect(() => {
    latest.current = { editor, objects, zoom };
  });

  const toPage = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current!.getBoundingClientRect();
    const z = latest.current.zoom;
    return { x: clamp((e.clientX - r.left) / z, 0, page.width), y: clamp((e.clientY - r.top) / z, 0, page.height) };
  }, [page.width, page.height]);

  const schedule = (fn: () => void) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(fn);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ---------- helpers ---------- */

  const selectedObjects = () => {
    const ids = new Set(latest.current.editor.selectedIds);
    return latest.current.objects.filter((o) => ids.has(o.id));
  };

  const clearLive = () => {
    liveStroke.current?.setAttribute("d", "");
    liveLasso.current?.setAttribute("d", "");
    setLiveBox(null);
  };

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, p: Point) => {
    const radius = latest.current.editor.sizes.eraser / 2;
    const dist = Math.hypot(p.x - g.last.x, p.y - g.last.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(2, radius / 2)));
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const q = { x: g.last.x + ((p.x - g.last.x) * i) / steps, y: g.last.y + ((p.y - g.last.y) * i) / steps };
      for (const o of latest.current.objects) {
        if (!g.erased.has(o.id) && hitsObject(o, q, radius)) {
          g.erased.add(o.id);
          changed = true;
        }
      }
    }
    g.last = p;
    if (changed) setPreview({ overrides: new Map(), hidden: new Set(g.erased) });
  };

  const applyTransform = (g: Extract<Gesture, { kind: "move" | "resize" }>, p: Point, shift: boolean) => {
    const overrides = new Map<string, NotebookObject>();
    if (g.kind === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * latest.current.zoom < 3) return;
      g.moved = true;
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      for (const o of g.originals) overrides.set(o.id, moveObject(o, dx, dy));
    } else {
      const keep = shift || g.originals.some((o) => o.type === "INK" || o.type === "EQUATION");
      const to = resizeBounds(g.startBounds, g.handle, p, keep && g.handle.length === 2);
      for (const o of g.originals) overrides.set(o.id, transformObject(o, g.startBounds, to));
    }
    setPreview({ overrides, hidden: new Set() });
  };

  /* ---------- pointer events ---------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (gesture.current) return;
    if (e.pointerType === "pen") markPenDetected();
    const { editor: ed } = latest.current;

    if (e.pointerType === "touch" && isPenDetected()) {
      // Palm rejection: once a stylus has been used, fingers pan instead of draw.
      gesture.current = { kind: "pan", pid: e.pointerId, x: e.clientX, y: e.clientY };
      rootRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const target = e.target as HTMLElement;
    const p = toPage(e);
    const tool = ed.tool;
    const capture = () => rootRef.current!.setPointerCapture(e.pointerId);

    if (DRAWING_TOOLS.includes(tool)) {
      capture();
      const t = tool as "pen" | "pencil" | "highlighter";
      gesture.current = {
        kind: "stroke",
        pid: e.pointerId,
        pts: [p],
        pressures: [e.pressure || 0.5],
        times: [0],
        t0: e.timeStamp,
        style: inkStyleFor(t, ed.color, ed.sizes[t]),
        pen: e.pointerType === "pen",
      };
      paintStroke(gesture.current);
      patchEditor({ selectedIds: [], region: null });
      return;
    }

    if (tool === "eraser") {
      capture();
      const g: Gesture = { kind: "erase", pid: e.pointerId, erased: new Set(), last: p };
      gesture.current = g;
      eraseAt(g, p);
      patchEditor({ selectedIds: [], region: null });
      return;
    }

    if (tool === "lasso") {
      capture();
      gesture.current = { kind: "lasso", pid: e.pointerId, pts: [p] };
      patchEditor({ selectedIds: [], region: null });
      return;
    }

    if (tool === "shape") {
      capture();
      gesture.current = { kind: "shape", pid: e.pointerId, start: p };
      patchEditor({ selectedIds: [], region: null });
      return;
    }

    if (tool === "select") {
      const handle = target.dataset.handle as Handle | undefined;
      if (handle) {
        capture();
        const originals = selectedObjects();
        const b = boundsOfObjects(originals);
        if (b) gesture.current = { kind: "resize", pid: e.pointerId, handle, startBounds: b, originals };
        return;
      }
      const hit = pickTop(latest.current.objects, p, TOUCH_TOLERANCE / latest.current.zoom + 2);
      capture();
      if (hit) {
        let ids = ed.selectedIds;
        if (e.shiftKey) ids = ids.includes(hit.id) ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
        else if (!ids.includes(hit.id)) ids = [hit.id];
        patchEditor({ selectedIds: ids, region: null });
        const set = new Set(ids);
        gesture.current = { kind: "move", pid: e.pointerId, start: p, originals: latest.current.objects.filter((o) => set.has(o.id)), moved: false };
      } else {
        gesture.current = { kind: "marquee", pid: e.pointerId, start: p, additive: e.shiftKey, base: e.shiftKey ? ed.selectedIds : [] };
        if (!e.shiftKey) patchEditor({ selectedIds: [], region: null });
      }
    }
    // text / equation tools act on click (see onClick) so focus is not stolen on pointerdown.
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (eraserCursor.current && latest.current.editor.tool === "eraser") {
      const p = toPage(e);
      eraserCursor.current.setAttribute("cx", String(p.x));
      eraserCursor.current.setAttribute("cy", String(p.y));
      eraserCursor.current.style.display = "block";
    }
    if (!g || g.pid !== e.pointerId) return;

    if (g.kind === "pan") {
      scrollRef.current?.scrollBy(g.x - e.clientX, g.y - e.clientY);
      g.x = e.clientX;
      g.y = e.clientY;
      return;
    }

    const native = e.nativeEvent;
    const events = g.kind === "stroke" && typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [native];

    if (g.kind === "stroke") {
      for (const ev of list) {
        const p = toPage(ev);
        const last = g.pts[g.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.6) continue;
        g.pts.push(p);
        g.pressures.push(ev.pressure || 0.5);
        g.times.push(ev.timeStamp - g.t0);
      }
      schedule(() => paintStroke(g));
      return;
    }

    const p = toPage(e);
    switch (g.kind) {
      case "erase":
        eraseAt(g, p);
        break;
      case "lasso":
        g.pts.push(p);
        schedule(() => liveLasso.current?.setAttribute("d", polyPath(g.pts, true)));
        break;
      case "move":
      case "resize":
        schedule(() => applyTransform(g, p, e.shiftKey));
        break;
      case "marquee": {
        const rect = normaliseRect(g.start, p);
        schedule(() => setLiveBox({ kind: "marquee", rect }));
        break;
      }
      case "shape": {
        const shiftKey = e.shiftKey;
        schedule(() => setLiveBox(shapeBox(latest.current.editor.shapeKind, g.start, p, shiftKey)));
        break;
      }
    }
  };

  const finish = (e: React.PointerEvent, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.pid !== e.pointerId) return;
    gesture.current = null;
    cancelAnimationFrame(raf.current);
    const { editor: ed } = latest.current;
    const p = toPage(e);
    clearLive();

    if (cancelled) {
      setPreview(null);
      return;
    }

    switch (g.kind) {
      case "stroke": {
        const hasPressure = g.pen && new Set(g.pressures.map((x) => Math.round(x * 100))).size > 2;
        const ink = makeInk(newId(), { points: g.pts, pressures: g.pressures, times: g.times, hasPressure }, g.style, nextZ(latest.current.objects));
        onCommit([{ before: null, after: ink }]);
        break;
      }
      case "erase": {
        setPreview(null);
        const gone = latest.current.objects.filter((o) => g.erased.has(o.id));
        if (gone.length > 0) onCommit(gone.map((o) => ({ before: o, after: null })));
        break;
      }
      case "move":
      case "resize": {
        applyTransformFinal(g, p, e.shiftKey);
        break;
      }
      case "marquee": {
        const rect = normaliseRect(g.start, p);
        setPreview(null);
        if (rect.width < 4 && rect.height < 4) break;
        const hits = latest.current.objects.filter((o) => rectsIntersect(rect, o)).map((o) => o.id);
        patchEditor({
          selectedIds: Array.from(new Set([...g.base, ...hits])),
          region: { kind: "rect", polygon: [rect.x, rect.y, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height], bounds: rect },
        });
        break;
      }
      case "lasso": {
        if (g.pts.length < 8) break;
        const hits = objectsInLasso(latest.current.objects, g.pts).map((o) => o.id);
        const flat = g.pts.flatMap((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]);
        const xs = g.pts.map((q) => q.x);
        const ys = g.pts.map((q) => q.y);
        const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        patchEditor({ selectedIds: hits, region: { kind: "lasso", polygon: flat, bounds } });
        break;
      }
      case "shape": {
        const box = shapeBox(ed.shapeKind, g.start, p, e.shiftKey);
        if (box.rect.width < 4 && box.rect.height < 4) break;
        const shape: ShapeObject = {
          id: newId(),
          type: "SHAPE",
          source: "USER",
          ...box.rect,
          rotation: 0,
          zIndex: nextZ(latest.current.objects),
          linkedToId: null,
          metadata: null,
          data: {
            shape: ed.shapeKind,
            stroke: ed.color,
            strokeWidth: ed.sizes.shape,
            fill: null,
            flipX: box.flip?.[0] ?? false,
            flipY: box.flip?.[1] ?? false,
          },
        };
        onCommit([{ before: null, after: shape }]);
        break;
      }
    }
  };

  const applyTransformFinal = (g: Extract<Gesture, { kind: "move" | "resize" }>, p: Point, shift: boolean) => {
    const overrides = new Map<string, NotebookObject>();
    if (g.kind === "move") {
      if (!g.moved) {
        setPreview(null);
        return;
      }
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      for (const o of g.originals) overrides.set(o.id, moveObject(o, dx, dy));
    } else {
      const keep = shift || g.originals.some((o) => o.type === "INK" || o.type === "EQUATION");
      const to = resizeBounds(g.startBounds, g.handle, p, keep && g.handle.length === 2);
      for (const o of g.originals) overrides.set(o.id, transformObject(o, g.startBounds, to));
    }
    setPreview(null);
    onCommit(g.originals.map((o) => ({ before: o, after: overrides.get(o.id) ?? o })));
  };

  const paintStroke = (g: Extract<Gesture, { kind: "stroke" }>) => {
    const flat: number[] = [];
    for (const q of g.pts) flat.push(q.x, q.y);
    if (g.pts.length === 1) flat.push(g.pts[0]!.x + 0.01, g.pts[0]!.y);
    const pr = g.pen ? g.pressures : undefined;
    const el = liveStroke.current;
    if (!el) return;
    el.setAttribute("d", strokePathData(flat, pr && pr.length * 2 === flat.length ? pr : undefined, g.style));
    el.setAttribute("fill", g.style.color);
    el.setAttribute("opacity", String(g.style.opacity));
  };

  /* ---------- click / double click (text, equation) ---------- */

  const beginEdit = (o: TextObject | EquationObject | null, p: Point) => {
    const { editor: ed, objects: objs } = latest.current;
    if (o) {
      patchEditor({ selectedIds: [o.id], region: null, editing: { isNew: false, original: o, draft: o } });
      return;
    }
    const z = nextZ(objs);
    if (ed.tool === "text") {
      const draft: TextObject = {
        id: newId(), type: "TEXT", source: "USER", x: p.x, y: p.y, width: 280, height: 30, rotation: 0, zIndex: z, linkedToId: null, metadata: null,
        data: { text: "", fontSize: 22, color: ed.color, fontFamily: "sans" },
      };
      patchEditor({ selectedIds: [], region: null, editing: { isNew: true, original: null, draft } });
    } else {
      const draft: EquationObject = {
        id: newId(), type: "EQUATION", source: "USER", x: p.x, y: p.y, width: 40, height: 32, rotation: 0, zIndex: z, linkedToId: null, metadata: null,
        data: { latex: "", fontSize: 28, color: ed.color },
      };
      patchEditor({ selectedIds: [], region: null, editing: { isNew: true, original: null, draft } });
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const { editor: ed, objects: objs } = latest.current;
    if (ed.editing) return;
    if (ed.tool !== "text" && ed.tool !== "equation") return;
    const p = toPage(e);
    const type = ed.tool === "text" ? "TEXT" : "EQUATION";
    const hit = pickTop(objs.filter((o) => o.type === type), p, 4);
    beginEdit(hit && (hit.type === "TEXT" || hit.type === "EQUATION") ? hit : null, p);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { editor: ed, objects: objs } = latest.current;
    if (ed.tool !== "select" || ed.editing) return;
    const hit = pickTop(objs, toPage(e), 4);
    if (hit && (hit.type === "TEXT" || hit.type === "EQUATION")) beginEdit(hit, toPage(e));
  };

  /* ---------- selection frame ---------- */

  const selected = displayObjects.filter((o) => editor.selectedIds.includes(o.id));
  const frame = boundsOfObjects(selected);
  const handles = frame ? handlesFor(selected) : [];
  const showFrame = frame && !editor.editing && (editor.tool === "select" || editor.tool === "lasso");

  const cursor =
    editor.tool === "select" ? "cursor-default" : editor.tool === "text" ? "cursor-text" : editor.tool === "eraser" ? "cursor-none" : "cursor-crosshair";

  return (
    <div
      ref={rootRef}
      data-testid="interaction-layer"
      className={cn("absolute inset-0 touch-none select-none", cursor, editor.tool === "textselect" && "pointer-events-none")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={() => {
        if (eraserCursor.current) eraserCursor.current.style.display = "none";
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <g transform={`scale(${zoom})`}>
          <path ref={liveStroke} />
          <path ref={liveLasso} fill="rgba(59,91,219,0.08)" stroke="#3b5bdb" strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
          <circle ref={eraserCursor} r={editor.sizes.eraser / 2} fill="rgba(0,0,0,0.04)" stroke="#6b6965" strokeWidth={1 / zoom} style={{ display: "none" }} />
          {editor.region && (editor.tool === "select" || editor.tool === "lasso") && (
            <path
              data-testid="selection-region"
              d={polyPath(pointsOf(editor.region.polygon), true)}
              fill="rgba(59,91,219,0.06)"
              stroke="#3b5bdb"
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            />
          )}
          {liveBox?.kind === "marquee" && (
            <rect {...liveBox.rect} fill="rgba(59,91,219,0.08)" stroke="#3b5bdb" strokeWidth={1 / zoom} />
          )}
          {liveBox?.kind === "shape" && <ShapePreview box={liveBox} editor={editor} />}
        </g>
        {showFrame && frame && (
          <g>
            <rect
              x={frame.x * zoom - 3}
              y={frame.y * zoom - 3}
              width={frame.width * zoom + 6}
              height={frame.height * zoom + 6}
              fill="none"
              stroke="#3b5bdb"
              strokeWidth={1.25}
              rx={3}
            />
          </g>
        )}
      </svg>

      {showFrame && frame &&
        handles.map((h) => {
          const pos = handlePosition(frame, h, zoom);
          return (
            <div
              key={h}
              data-handle={h}
              style={{ left: pos.x - HANDLE_SIZE / 2, top: pos.y - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE, cursor: `${h}-resize` }}
              className="absolute rounded-sm border-[1.5px] border-accent bg-white"
            />
          );
        })}

      {editor.region && !editor.editing && (editor.tool === "select" || editor.tool === "lasso") && props.onAskAi && (
        <button
          data-testid="ask-ai"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onAskAi?.();
          }}
          className="absolute flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-accent/90"
          style={{ left: Math.max(4, (editor.region.bounds.x + editor.region.bounds.width) * zoom - 84), top: Math.max(4, editor.region.bounds.y * zoom - 38) }}
        >
          <Sparkles size={13} /> Ask AI
        </button>
      )}

      {showFrame && frame && editor.selectedIds.length > 0 && (
        <div
          className="absolute flex gap-1 rounded-lg border border-line bg-white p-1 shadow-md"
          style={{ left: frame.x * zoom, top: Math.max(4, (frame.y + frame.height) * zoom + 12) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button aria-label="Duplicate selection" title="Duplicate (Ctrl+D)" onClick={props.onDuplicate} className="rounded-md p-1.5 hover:bg-black/5">
            <Copy size={15} />
          </button>
          <button aria-label="Delete selection" title="Delete" onClick={props.onDeleteSelection} className="rounded-md p-1.5 text-danger hover:bg-black/5">
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- small helpers ---------- */

function pointsOf(flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

function polyPath(pts: Point[], close: boolean): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("") + (close ? "Z" : "");
}

function handlesFor(selected: NotebookObject[]): Handle[] {
  if (selected.length === 1 && selected[0]!.type === "TEXT") return ["w", "e"];
  if (selected.some((o) => o.type === "INK" || o.type === "EQUATION")) return ["nw", "ne", "se", "sw"];
  return ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
}

function handlePosition(b: Rect, h: Handle, zoom: number): Point {
  const pad = 3;
  const l = b.x * zoom - pad;
  const t = b.y * zoom - pad;
  const r = (b.x + b.width) * zoom + pad;
  const bt = (b.y + b.height) * zoom + pad;
  const mx = (l + r) / 2;
  const my = (t + bt) / 2;
  return {
    x: h.includes("w") ? l : h.includes("e") ? r : mx,
    y: h.includes("n") ? t : h.includes("s") ? bt : my,
  };
}

function shapeBox(kind: string, a: Point, b: Point, shift: boolean) {
  let end = b;
  if (shift) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (kind === "line" || kind === "arrow") {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      end = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    } else {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      end = { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
    }
  }
  return { kind: "shape" as const, rect: normaliseRect(a, end), shape: kind, flip: [end.x < a.x, end.y < a.y] as [boolean, boolean] };
}

function ShapePreview({ box, editor }: { box: { rect: Rect; shape?: string; flip?: [boolean, boolean] }; editor: EditorState }) {
  const { rect: r, flip } = box;
  const common = { fill: "none", stroke: editor.color, strokeWidth: editor.sizes.shape, strokeLinecap: "round" as const, opacity: 0.8 };
  if (box.shape === "ellipse") return <ellipse cx={r.x + r.width / 2} cy={r.y + r.height / 2} rx={r.width / 2} ry={r.height / 2} {...common} />;
  if (box.shape === "rect") return <rect {...r} {...common} />;
  const x1 = flip?.[0] ? r.x + r.width : r.x;
  const y1 = flip?.[1] ? r.y + r.height : r.y;
  const x2 = flip?.[0] ? r.x : r.x + r.width;
  const y2 = flip?.[1] ? r.y : r.y + r.height;
  return <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />;
}
