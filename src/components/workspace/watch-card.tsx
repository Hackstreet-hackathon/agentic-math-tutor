"use client";
import { Eye, EyeOff, Lightbulb, Loader2, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { speak } from "@/lib/client/speak";
import { isConversationActive } from "@/lib/client/speech-state";
import { cn } from "@/lib/utils";
import type { FlagView, WatchState } from "./use-work-watcher";

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

/** Wavy underline under the wrong line only (like a spelling mistake), with a tappable marker that opens the nudge. Never saved. */
export function FlagOverlay({
  flag,
  zoom,
  pageWidth,
  onShowMe,
  onFix,
  onNotAMistake,
}: {
  flag: FlagView;
  zoom: number;
  pageWidth: number;
  onShowMe: () => void;
  onFix: () => void;
  onNotAMistake: () => void;
}) {
  // In a voice conversation the tutor raises the mistake itself, so the card starts collapsed and never covers
  // the line the student writes next; tap the "!" to open it. Without a conversation it opens straight away.
  const [open, setOpen] = useState(() => !isConversationActive());
  const [hint, setHint] = useState(false);
  const r = flag.rect;
  const left = Math.max(0, r.x - 4) * zoom;
  const width = (r.width + 8) * zoom;
  const underlineY = (r.y + r.height + 2) * zoom;
  const cardLeft = Math.min(left, Math.max(0, pageWidth * zoom - 296));
  return (
    <div className="pointer-events-none absolute left-0 top-0 z-20" style={{ width: pageWidth * zoom }}>
      <svg data-testid="watch-underline" className="absolute" style={{ left, top: underlineY - 2 }} width={width} height="6" aria-hidden="true">
        <defs>
          <pattern id="wavy" width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 3 Q1.5 0 3 3 T6 3" fill="none" stroke="#dc2626" strokeWidth="1.4" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={width} height="6" fill="url(#wavy)" />
      </svg>
      <button
        type="button"
        data-testid="watch-flag"
        aria-label="Something looks off in this step"
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto absolute grid h-5 w-5 place-items-center rounded-full bg-red-600 text-[11px] font-bold text-white shadow animate-pulse"
        style={{ left: Math.max(2, left - 24), top: underlineY - 18 }}
      >
        !
      </button>
      {open && (
        <div className="pointer-events-auto absolute w-72 rounded-xl border border-red-200 bg-white p-3 text-sm shadow-lg" style={{ left: cardLeft, top: underlineY + 8 }} role="status">
          <p className="font-medium text-red-700">Hmm, take another look at this step</p>
          {hint && <p data-testid="watch-hint" className="mt-1 text-ink">{flag.nudge}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="watch-hint-btn"
              onClick={() => {
                setHint(true);
                void speak(flag.nudge);
              }}
              className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              <Lightbulb size={12} /> Hint
            </button>
            <button type="button" onClick={onShowMe} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90">Show me</button>
            <button type="button" onClick={onFix} className="rounded-lg px-2.5 py-1 text-xs font-medium hover:bg-black/5">I’ll fix it</button>
            <button type="button" onClick={onNotAMistake} className="rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-black/5">Not a mistake</button>
          </div>
        </div>
      )}
    </div>
  );
}
