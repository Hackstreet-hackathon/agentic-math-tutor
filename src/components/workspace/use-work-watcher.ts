"use client";
import { useEffect, useRef, useState } from "react";
import type { WatchFlag } from "@/lib/ai/watch";
import { ChatError, getAiStatus, watchWork } from "@/lib/client/ai";
import type { PageDto } from "@/lib/client/api";
import { captureRegionImage } from "@/lib/client/region-image";
import { speak, isSpeaking } from "@/lib/client/speak";
import { unionRects, boundsOf, type Rect } from "@/lib/notebook/geometry";
import type { NotebookObject } from "@/lib/notebook/schemas";

export type WatchState = "off" | "idle" | "checking" | "ok" | "flagged" | "unsure" | "needs-vision" | "paused" | "unavailable";

export const PAUSE_MS = 2500;
const VOICE_COOLDOWN_MS = 45_000;
const MIN_GAP_MS = 4000;

/** Student-written content that is worth checking (never AI cards, graphs or selections). */
export function studentWork(objects: NotebookObject[]): NotebookObject[] {
  return objects.filter((o) => o.source === "USER" && (o.type === "INK" || o.type === "TEXT" || o.type === "EQUATION"));
}

/** Cheap fingerprint of the student's work: changes whenever something is added, edited, moved or erased. */
export function workSignature(work: NotebookObject[]): string {
  return work
    .map((o) => {
      const body = o.type === "INK" ? o.data.points.length : o.type === "TEXT" ? o.data.text : o.type === "EQUATION" ? o.data.latex : "";
      return `${o.id}:${Math.round(o.x)},${Math.round(o.y)}:${body}`;
    })
    .sort()
    .join("|");
}

/** The area holding the problem and the working: all student work, plus room above for a printed problem. */
export function workBounds(work: NotebookObject[], page: { width: number; height: number }): Rect | null {
  const u = unionRects(work.map(boundsOf));
  if (!u) return null;
  const top = Math.max(0, u.y - 200);
  return { x: 0, y: top, width: page.width, height: Math.min(page.height, u.y + u.height + 24) - top };
}

const key = (pageId: string, latex: string) => `${pageId}::${latex.replace(/\s+/g, "")}`;

/**
 * Watches the current page. Once the student stops writing for a moment, the work is checked and the first
 * wrong step (if any) is returned as a flag. Does nothing while disabled.
 */
export function useWorkWatcher(opts: { enabled: boolean; voice: boolean; notebookId: string; page: PageDto | undefined }) {
  const { enabled, voice, notebookId, page } = opts;
  const [state, setState] = useState<WatchState>("off");
  const [flag, setFlag] = useState<{ pageId: string; flag: WatchFlag } | null>(null);
  const [vision, setVision] = useState<boolean | null>(null);
  const ignored = useRef<Map<string, string[]>>(new Map());
  const lastSig = useRef<Map<string, string>>(new Map());
  const lastRun = useRef(0);
  const spoken = useRef<{ keys: Set<string>; at: number }>({ keys: new Set(), at: 0 });
  const abort = useRef<AbortController | null>(null);
  const pauseUntil = useRef(0);

  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });
  const maybeSpeak = (f: WatchFlag, pid: string) => {
    const k = key(pid, f.latex);
    const s = spoken.current;
    if (!voiceRef.current || !f.voiceLine || s.keys.has(k) || Date.now() - s.at < VOICE_COOLDOWN_MS || isSpeaking()) return;
    s.keys.add(k);
    s.at = Date.now();
    void speak(f.voiceLine);
  };

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getAiStatus()
      .then((s) => !cancelled && (s.configured ? setVision(Boolean(s.capabilities?.vision)) : setState("unavailable")))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const pageId = page?.id;
  const objects = page?.objects;
  const sig = objects ? workSignature(studentWork(objects)) : "";

  useEffect(() => {
    if (!enabled) {
      abort.current?.abort();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("off");
      setFlag(null);
      return;
    }
    if (!page || !pageId || vision === null) return;
    const work = studentWork(page.objects);
    if (work.length === 0) {
      setState("idle");
      setFlag(null);
      return;
    }
    if (lastSig.current.get(pageId) === sig) return;

    // A flag on text the student has since changed is stale.
    setFlag((f) => (f && f.pageId === pageId ? null : f));
    abort.current?.abort();

    const wait = Math.max(PAUSE_MS, lastRun.current + MIN_GAP_MS - Date.now(), pauseUntil.current - Date.now());
    const timer = setTimeout(async () => {
      const hasInk = work.some((o) => o.type === "INK");
      const typed = work
        .filter((o) => o.type === "TEXT" || o.type === "EQUATION")
        .sort((a, b) => a.y - b.y)
        .map((o) => (o.type === "TEXT" ? o.data.text : o.type === "EQUATION" ? o.data.latex : ""))
        .filter(Boolean);
      if (hasInk && !vision && typed.length === 0) {
        setState("needs-vision");
        return;
      }
      const area = workBounds(work, page);
      if (!area) return;
      // Same crop as captureRegionImage uses internally, so the model's relative y maps back onto the page.
      const pad = 16;
      const x = Math.max(0, area.x - pad);
      const y = Math.max(0, area.y - pad);
      const crop: Rect = { x, y, width: Math.min(page.width, area.x + area.width + pad) - x, height: Math.min(page.height, area.y + area.height + pad) - y };
      const pdfCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-background"] canvas');
      const image = vision ? captureRegionImage({ page, bounds: area, objects: page.objects, pdfCanvas }) : null;

      const ac = new AbortController();
      abort.current = ac;
      lastRun.current = Date.now();
      setState("checking");
      try {
        const r = await watchWork(
          { notebookId, pageId, bounds: crop, image, typedLines: typed, ignoredSteps: ignored.current.get(pageId) ?? [] },
          ac.signal,
        );
        lastSig.current.set(pageId, sig);
        if (r.flag) {
          setFlag({ pageId, flag: r.flag });
          setState("flagged");
          maybeSpeak(r.flag, pageId);
        } else {
          setFlag(null);
          setState(r.status === "ok" ? "ok" : r.status === "unsure" ? "unsure" : "idle");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof ChatError && e.code === "rate_limited") pauseUntil.current = Date.now() + (e.retryAfterSec ?? 30) * 1000;
        setState("paused");
      }
    }, wait);
    return () => clearTimeout(timer);
    // `page` is read for dimensions/objects; the signature is what actually decides whether to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig, pageId, vision]);

  useEffect(() => () => abort.current?.abort(), []);

  /** "Not a mistake": never flag this exact step again on this page. */
  const dismissForever = () => {
    if (!flag) return;
    ignored.current.set(flag.pageId, [...(ignored.current.get(flag.pageId) ?? []), flag.flag.latex]);
    setFlag(null);
    setState("idle");
  };
  /** "I'll fix it": hide until the work changes. */
  const dismiss = () => {
    setFlag(null);
    setState("idle");
  };

  return { state, flag: flag && flag.pageId === pageId ? flag.flag : null, dismiss, dismissForever, visionAvailable: vision };
}
