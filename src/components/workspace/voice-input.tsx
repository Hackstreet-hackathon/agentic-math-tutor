"use client";
import { Loader2, Mic, MicOff } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

type State = "idle" | "recording" | "processing" | "error";

export function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const [state, setState] = useState<State>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const resetToIdleAfterError = () => {
    setTimeout(() => setState("idle"), 3000);
  };

  const handleServerSTT = useCallback(
    async (blob: Blob): Promise<boolean> => {
      try {
        const form = new FormData();
        form.append("audio", blob, "audio.webm");
        const res = await fetch("/api/ai/stt", { method: "POST", body: form });
        if (res.status === 503) return false; // not configured — fall through to browser
        if (!res.ok) return false;
        const json = (await res.json()) as { transcript?: string };
        if (json.transcript) {
          onTranscript(json.transcript);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [onTranscript],
  );

  const handleBrowserSTT = useCallback(
    (blob: Blob): Promise<boolean> => {
      return new Promise((resolve) => {
        type SpeechRecognitionConstructor = new () => {
          continuous: boolean;
          interimResults: boolean;
          onresult: ((event: SpeechRecognitionEvent) => void) | null;
          onerror: (() => void) | null;
          onend: (() => void) | null;
          start: () => void;
        };
        const w = window as unknown as {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        };
        const SpeechRecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;

        if (!SpeechRecognitionCtor) {
          resolve(false);
          return;
        }

        // For browser fallback we re-play the blob via an audio element and
        // run recognition in parallel, but the simplest approach is to just
        // start a fresh recognition session (no audio argument needed).
        void blob; // blob not used by browser SpeechRecognition
        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const transcript = event.results[0]?.[0]?.transcript ?? "";
          if (transcript) {
            onTranscript(transcript);
            resolve(true);
          } else {
            resolve(false);
          }
        };

        recognition.onerror = () => resolve(false);
        recognition.onend = () => resolve(false);

        try {
          recognition.start();
        } catch {
          resolve(false);
        }
      });
    },
    [onTranscript],
  );

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        setState("processing");

        const serverSuccess = await handleServerSTT(blob);
        if (serverSuccess) {
          setState("idle");
          return;
        }

        const browserSuccess = await handleBrowserSTT(blob);
        if (browserSuccess) {
          setState("idle");
          return;
        }

        setState("error");
        resetToIdleAfterError();
      };

      recorder.start();
      setState("recording");
    } catch {
      setState("error");
      resetToIdleAfterError();
    }
  }, [handleServerSTT, handleBrowserSTT]);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (state === "idle") {
      void startRecording();
    } else if (state === "recording") {
      stopRecording();
    }
  }, [disabled, state, startRecording, stopRecording]);

  if (state === "processing") {
    return (
      <button type="button" disabled aria-label="Processing audio" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted">
        <Loader2 size={16} className="animate-spin" />
      </button>
    );
  }

  if (state === "error") {
    return (
      <button type="button" disabled aria-label="Voice input error" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-500">
        <MicOff size={16} />
      </button>
    );
  }

  if (state === "recording") {
    return (
      <button
        type="button"
        aria-label="Stop recording"
        onClick={handleClick}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-300 bg-red-50 text-red-500"
      >
        <span className="absolute inset-0 animate-pulse rounded-xl bg-red-200/60" />
        <Mic size={16} className="relative" />
      </button>
    );
  }

  // idle
  return (
    <button
      type="button"
      aria-label="Start voice input"
      onClick={handleClick}
      disabled={disabled}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted hover:bg-black/5 disabled:opacity-30"
    >
      <Mic size={16} />
    </button>
  );
}
