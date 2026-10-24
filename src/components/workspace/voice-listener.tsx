"use client";
import { Loader2, Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface VoiceListenerProps {
  /** Called when a math question is recognized */
  onMathQuestion: (transcript: string) => void;
  /** Whether the listener is active */
  active: boolean;
  /** Called to toggle active state */
  onToggle: () => void;
}

type ListenerState = "off" | "listening" | "speech_detected" | "processing" | "classifying";

/** Flash message shown briefly after classification */
type FlashMsg = { ok: true } | { ok: false } | null;

export function VoiceListener({ onMathQuestion, active, onToggle }: VoiceListenerProps) {
  const [state, setState] = useState<ListenerState>("off");
  const [flash, setFlash] = useState<FlashMsg>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for the audio pipeline — not state because changes should not re-render
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechStartRef = useRef<number | null>(null);
  const lastSpeechRef = useRef<number>(0);
  const processingRef = useRef(false);

  const stopPipeline = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { void audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    speechStartRef.current = null;
    lastSpeechRef.current = 0;
    processingRef.current = false;
  }, []);

  const startLoop = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        // Browsers only expose the microphone on https:// or http://localhost.
        throw new DOMException("insecure", "SecurityError");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      ctx.createMediaStreamSource(stream).connect(analyser);

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (!processingRef.current) return;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        setState("processing");

        try {
          // Step 1: transcribe
          const form = new FormData();
          form.append("audio", blob, "audio.webm");
          const sttRes = await fetch("/api/ai/stt", { method: "POST", body: form });

          let transcript = "";
          if (sttRes.ok) {
            const sttJson = (await sttRes.json()) as { transcript?: string };
            transcript = sttJson.transcript ?? "";
          }
          // 503 means no server STT — we have no browser fallback in always-on mode,
          // so just skip this recording cycle

          if (!transcript.trim()) {
            processingRef.current = false;
            restartRecorder();
            setState("listening");
            return;
          }

          // Step 2: classify
          setState("classifying");
          let isMath = true;
          try {
            const clRes = await fetch("/api/ai/classify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: transcript }),
            });
            if (clRes.ok) {
              const clJson = (await clRes.json()) as { isMathQuestion?: boolean };
              isMath = clJson.isMathQuestion ?? true;
            }
          } catch {
            // network error → optimistic
          }

          if (isMath) {
            setFlash({ ok: true });
            onMathQuestion(transcript);
          } else {
            setFlash({ ok: false });
          }

          // Clear flash after 1.5 s
          setTimeout(() => setFlash(null), 1500);
        } catch {
          // ignore errors in the processing loop
        } finally {
          processingRef.current = false;
          restartRecorder();
          setState("listening");
        }
      };

      recorder.start();
      setState("listening");

      // Silence-detection tick
      tickRef.current = setInterval(() => {
        const analyser = analyserRef.current;
        if (!analyser || processingRef.current) return;

        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(
          data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / data.length,
        );

        const now = Date.now();

        if (rms > 0.02) {
          // Speech present
          if (speechStartRef.current === null) speechStartRef.current = now;
          lastSpeechRef.current = now;
          setState("speech_detected");
        } else {
          // Silence
          if (
            speechStartRef.current !== null &&
            now - lastSpeechRef.current > 1500
          ) {
            // Enough silence after speech — trigger
            speechStartRef.current = null;
            processingRef.current = true;
            recorderRef.current?.stop();
          } else if (speechStartRef.current === null) {
            setState("listening");
          }
        }
      }, 100);
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === "SecurityError"
          ? "Microphone needs https:// or http://localhost. Open the app at http://localhost:3100."
          : name === "NotAllowedError"
            ? "Microphone is blocked. Click the lock/site-settings icon in the address bar and allow the microphone."
            : name === "NotFoundError"
              ? "No microphone found."
              : "Could not start the microphone.",
      );
      setState("off");
      onToggle();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMathQuestion]);

  /** Restart the MediaRecorder (reuse existing stream & analyser) */
  function restartRecorder() {
    const stream = streamRef.current;
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    // Re-attach the same onstop logic by recursing through the same path
    recorder.onstop = recorderRef.current.onstop;
    recorder.start();
  }

  useEffect(() => {
    if (active) {
      void startLoop();
    } else {
      stopPipeline();
      setState("off");
    }
    return () => {
      stopPipeline();
    };
  }, [active, startLoop, stopPipeline]);

  /* ---- UI ---- */
  const isProcessing = state === "processing" || state === "classifying";

  if (isProcessing) {
    return (
      <button
        type="button"
        aria-label="Processing voice"
        disabled
        className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-muted"
      >
        <Loader2 size={13} className="animate-spin" />
      </button>
    );
  }

  if (flash) {
    return (
      <button
        type="button"
        disabled
        aria-label={flash.ok ? "Sending math question" : "Not a math question"}
        className={cn(
          "flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
          flash.ok
            ? "bg-green-100 text-green-800"
            : "bg-black/5 text-muted",
        )}
      >
        {flash.ok ? "✓ Sending…" : "Not a math question"}
      </button>
    );
  }

  if (error) {
    return (
      <button
        type="button"
        role="alert"
        title={error}
        onClick={() => setError(null)}
        className="flex max-w-[11rem] items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-left text-[11px] leading-tight text-red-700"
      >
        <MicOff size={13} className="shrink-0" />
        <span>{error}</span>
      </button>
    );
  }

  if (state === "off") {
    return (
      <button
        type="button"
        aria-label="Enable always-on voice listener"
        onClick={onToggle}
        title="Enable always-on voice"
        className="grid h-7 w-7 place-items-center rounded-full text-muted/60 hover:text-muted"
      >
        <Mic size={13} />
      </button>
    );
  }

  // listening or speech_detected
  const isSpeech = state === "speech_detected";
  return (
    <button
      type="button"
      aria-label="Disable always-on voice listener"
      onClick={onToggle}
      title="Listening — click to stop"
      className={cn(
        "relative grid h-7 w-7 place-items-center rounded-full",
        isSpeech ? "text-blue-600" : "text-green-600",
      )}
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full animate-pulse",
          isSpeech ? "bg-blue-200/70" : "bg-green-200/50",
        )}
      />
      <Mic size={13} className="relative" />
    </button>
  );
}
