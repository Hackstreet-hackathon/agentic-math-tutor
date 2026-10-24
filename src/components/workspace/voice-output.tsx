"use client";
import { Loader2, StopCircle, Volume2, VolumeX } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { latexToSpeech, stepsToSpeech } from "@/lib/notebook/latex-to-speech";

interface VoiceOutputProps {
  steps: { latex: string | null; explanation: string }[];
  finalAnswer: string | null;
  disabled?: boolean;
}

type State = "idle" | "loading" | "playing" | "error";

export function VoiceOutput({ steps, finalAnswer, disabled }: VoiceOutputProps) {
  const [state, setState] = useState<State>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const resetToIdleAfterError = useCallback(() => {
    setTimeout(() => setState("idle"), 3000);
  }, []);

  const playWithBrowserTTS = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) {
      setState("error");
      resetToIdleAfterError();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setState("idle");
    utterance.onerror = () => {
      setState("error");
      resetToIdleAfterError();
    };
    window.speechSynthesis.speak(utterance);
    setState("playing");
  }, [resetToIdleAfterError]);

  const handlePlay = useCallback(async () => {
    const text = stepsToSpeech(steps, finalAnswer);
    if (!text.trim()) return;

    setState("loading");

    try {
      const res = await fetch("/api/ai/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.status === 503) {
        // TTS not configured — use browser fallback
        playWithBrowserTTS(text);
        return;
      }

      if (!res.ok) {
        setState("error");
        resetToIdleAfterError();
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        cleanup();
        setState("idle");
      };

      audio.onerror = () => {
        cleanup();
        setState("error");
        resetToIdleAfterError();
      };

      await audio.play();
      setState("playing");
    } catch {
      cleanup();
      setState("error");
      resetToIdleAfterError();
    }
  }, [steps, finalAnswer, cleanup, playWithBrowserTTS, resetToIdleAfterError]);

  const handleStop = useCallback(() => {
    cleanup();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setState("idle");
  }, [cleanup]);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (state === "playing") {
      handleStop();
    } else if (state === "idle") {
      void handlePlay();
    }
  }, [disabled, state, handlePlay, handleStop]);

  const latexText = latexToSpeech; // silence unused import warning
  void latexText;

  if (state === "loading") {
    return (
      <button type="button" disabled aria-label="Loading audio" className="grid h-7 w-7 place-items-center rounded-full text-muted">
        <Loader2 size={14} className="animate-spin" />
      </button>
    );
  }

  if (state === "error") {
    return (
      <button type="button" disabled aria-label="Voice output error" className="grid h-7 w-7 place-items-center rounded-full text-red-500">
        <VolumeX size={14} />
      </button>
    );
  }

  if (state === "playing") {
    return (
      <button
        type="button"
        aria-label="Stop reading aloud"
        onClick={handleClick}
        className="grid h-7 w-7 place-items-center rounded-full text-accent hover:bg-accent-soft"
      >
        <StopCircle size={14} />
      </button>
    );
  }

  // idle
  return (
    <button
      type="button"
      aria-label="Read answer aloud"
      onClick={handleClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-full text-muted hover:text-ink disabled:opacity-30"
    >
      <Volume2 size={14} />
    </button>
  );
}
