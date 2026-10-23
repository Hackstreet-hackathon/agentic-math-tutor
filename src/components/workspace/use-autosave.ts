"use client";
import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { api } from "@/lib/client/api";
import { buildSave, hasDirty, type Action, type NotebookState } from "@/lib/notebook/store";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

const DEBOUNCE_MS = 800;
const RETRY_MS = 4000;

/**
 * Debounced, batched autosave. Only objects touched since the last successful save are
 * sent, one request per dirty page. Edits made while a save is in flight stay dirty
 * (revision-checked in the reducer) and are picked up by the next round.
 */
export function useAutosave(state: NotebookState, dispatch: Dispatch<Action>) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const stateRef = useRef(state);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    stateRef.current = state;
  });

  const flush = useCallback(
    async (keepalive = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("saving");
      let failed = false;
      try {
        for (const pageId of Object.keys(stateRef.current.dirty)) {
          const current = stateRef.current;
          const dirty = current.dirty[pageId];
          const page = current.pages.find((p) => p.id === pageId);
          if (!dirty || Object.keys(dirty).length === 0) continue;
          if (!page) continue;
          const { upserts, deletes, revs } = buildSave(page, dirty);
          await api.saveObjects(pageId, { upserts, deletes }, keepalive);
          dispatch({ type: "saved", pageId, revs });
        }
      } catch {
        failed = true;
      } finally {
        inFlight.current = false;
      }
      if (failed) {
        setStatus("error");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flushRef.current(), RETRY_MS);
      } else {
        // Re-check shortly: edits may have landed while the request was in flight.
        setTimeout(() => {
          if (!hasDirty(stateRef.current)) setStatus("saved");
          else {
            setStatus("unsaved");
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
          }
        }, 30);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    if (!hasDirty(state)) return;
    if (!inFlight.current) setStatus((s) => (s === "error" ? s : "unsaved"));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [state.dirty, flush, state]);

  // Best-effort flush when the tab is hidden or closed; warn if unsaved work remains.
  useEffect(() => {
    const onHide = () => {
      if (hasDirty(stateRef.current)) void flush(true);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasDirty(stateRef.current)) {
        void flush(true);
        e.preventDefault();
      }
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && onHide());
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush]);

  /** Resolve once everything is saved (or give up after a few passes, e.g. while offline). */
  const saveNow = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    for (let i = 0; i < 6; i++) {
      if (!hasDirty(stateRef.current) && !inFlight.current) return true;
      await flushRef.current();
      await new Promise((r) => setTimeout(r, 60));
    }
    return !hasDirty(stateRef.current);
  }, []);

  return { status, flush, saveNow };
}
