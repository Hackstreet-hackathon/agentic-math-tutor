"use client";
import { Eye, EyeOff, Loader2, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import type { WatchFlag } from "@/lib/ai/watch";
import { cn } from "@/lib/utils";
import type { WatchState } from "./use-work-watcher";

const LABEL: Record<WatchState, string> = {
  off: "Watch my work",
  idle: "Watching",
  checking: "Checking…",
  ok: "Looks good",
  flagged: "Check a step",
  unsure: "Can’t read it yet",
  "needs-vision": "Needs a vision model",
  paused: "Paused",
  unavailable: "AI not set up",
};

/** Top-bar control: turn tracking on/off, voice hints on/off, and show what the tracker is doing. */
export function WatchToggle({ enabled, onToggle, voice, onToggleVoice, state }: { enabled: boolean; onToggle: () => void; voice: boolean; onToggleVoice: () => void; state: WatchState }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid="watch-toggle"
        aria-pressed={enabled}
        onClick={onToggle}
        title="The tutor reads your working as you write and flags a wrong step"
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium",
          enabled ? "bg-accent-soft text-accent" : "text-muted hover:bg-black/5",
          state === "flagged" && "bg-red-50 text-red-700",
        )}
      >
        {state === "checking" ? <Loader2 size={14} className="animate-spin" /> : enabled ? <Eye size={14} /> : <EyeOff size={14} />}
        <span data-testid="watch-state">{LABEL[state]}</span>
      </button>
      {enabled && (
        <button type="button" aria-pressed={voice} aria-label={voice ? "Turn off spoken hints" : "Turn on spoken hints"} title="Spoken hints" onClick={onToggleVoice} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-black/5">
          {voice ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
      )}
    </div>
  );
}

/** Wavy underline under the wrong line, with a tappable marker that opens the nudge. Rendered above the page, never saved. */
export function FlagOverlay({
  flag,
  zoom,
  pageWidth,
  onShowMe,
  onFix,
  onNotAMistake,
}: {
  flag: WatchFlag;
  zoom: number;
  pageWidth: number;
  onShowMe: () => void;
  onFix: () => void;
  onNotAMistake: () => void;
}) {
  const [open, setOpen] = useState(true);
  const y = flag.y * zoom;
  return (
    <div className="pointer-events-none absolute left-0 top-0 z-20" style={{ width: pageWidth * zoom }}>
      <svg className="absolute left-0" style={{ top: y - 3 }} width={pageWidth * zoom} height="8" aria-hidden="true">
        <defs>
          <pattern id="wavy" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 4 Q2 0 4 4 T8 4" fill="none" stroke="#dc2626" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect x="40" y="0" width={Math.max(0, pageWidth * zoom - 80)} height="8" fill="url(#wavy)" opacity="0.8" />
      </svg>
      <button
        type="button"
        data-testid="watch-flag"
        aria-label="Something looks off in this step"
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto absolute grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-red-600 text-xs font-bold text-white shadow animate-pulse"
        style={{ left: 8, top: y }}
      >
        !
      </button>
      {open && (
        <div className="pointer-events-auto absolute w-72 rounded-xl border border-red-200 bg-white p-3 text-sm shadow-lg" style={{ left: 40, top: y + 10 }} role="status">
          <p className="font-medium text-red-700">Hmm, take another look at this step</p>
          <p className="mt-1 text-ink">{flag.nudge}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={onShowMe} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90">Show me</button>
            <button type="button" onClick={onFix} className="rounded-lg px-2.5 py-1 text-xs font-medium hover:bg-black/5">I’ll fix it</button>
            <button type="button" onClick={onNotAMistake} className="rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-black/5">Not a mistake</button>
          </div>
        </div>
      )}
    </div>
  );
}
