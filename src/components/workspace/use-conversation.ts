"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_STATE, isPhantomTranscript, type ConverseRequest, type TutorState } from "@/lib/ai/converse";
import { ChatError, streamConverse } from "@/lib/client/ai";
import { SpeechQueue } from "@/lib/client/speech-queue";

export type ConvoState = "off" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

export interface TurnPayload {
  selection: ConverseRequest["selection"];
  image: string | null;
  recognizedHandwriting?: string;
}

interface Options {
  active: boolean;
  notebookId: string;
  pageId: string | undefined;
  conversationId: string | null;
  onConversationId: (id: string) => void;
  /** Current circled region / selected objects / highlighted PDF text, captured fresh for each turn. */
  getPayload: () => Promise<TurnPayload>;
  onUser: (text: string) => void;
  onTutorStart: () => void;
  onTutorText: (textSoFar: string) => void;
  onTutorDone: () => void;
  onError: (message: string) => void;
  /** The student said "stop listening". */
  onStopListening: () => void;
}

const END_SILENCE_MS = 1100;
const MIN_SPEECH_MS = 500;
const BARGE_IN_MS = 300;
const IDLE_RESTART_MS = 8000;
const TICK_MS = 80;

/**
 * Always-listening voice conversation. Mic -> voice-activity detection -> Whisper (/api/ai/stt) ->
 * /api/ai/converse (fast model for chat, tutor model for maths) -> sentence-by-sentence speech.
 * The student can interrupt the tutor by speaking (barge-in).
 */
export function useConversation(opts: Options) {
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
  });

  const [state, setStateRaw] = useState<ConvoState>("off");
  const stateRef = useRef<ConvoState>("off");
  const setState = useCallback((s: ConvoState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  const queue = useRef<SpeechQueue | null>(null);
  const abort = useRef<AbortController | null>(null);
  const tutorState = useRef<TutorState>(IDLE_STATE);
  const conversationId = useRef<string | null>(opts.conversationId);
  useEffect(() => {
    conversationId.current = opts.conversationId;
  }, [opts.conversationId]);

  /** One full turn: transcript in, spoken answer out. */
  const handleTranscript = useCallback(
    async (transcript: string) => {
      const cur = o.current;
      if (!cur.pageId) return;
      queue.current ??= new SpeechQueue();
      const q = queue.current;
      const ac = new AbortController();
      abort.current = ac;
      q.resetLog();

      setState("thinking");
      cur.onUser(transcript);
      let text = "";
      let started = false;
      const begin = () => {
        if (started) return;
        started = true;
        cur.onTutorStart();
      };
      try {
        const payload = await cur.getPayload();
        await streamConverse(
          {
            notebookId: cur.notebookId,
            pageId: cur.pageId,
            conversationId: conversationId.current,
            transcript,
            selection: payload.selection,
            image: payload.image,
            recognizedHandwriting: payload.recognizedHandwriting,
            tutorState: tutorState.current,
          },
          {
            onMeta: (m) => {
              conversationId.current = m.conversationId;
              cur.onConversationId(m.conversationId);
            },
            onAck: (t) => {
              q.enqueue(t);
              setState("speaking");
            },
            onSentence: (t) => {
              begin();
              text += (text ? " " : "") + t;
              cur.onTutorText(text);
              q.enqueue(t);
              setState("speaking");
            },
            onState: (s) => {
              tutorState.current = s;
            },
            onControl: (c) => {
              if (c === "stop") q.cancel();
              else if (c === "stop_listening") cur.onStopListening();
              else if (c === "repeat") for (const s of [...q.spokenLog]) q.enqueue(s);
            },
          },
          ac.signal,
        );
        if (started) cur.onTutorDone();
        await q.whenIdle();
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          q.cancel();
          cur.onError((e as ChatError).message || "Something went wrong.");
        }
        if (started) cur.onTutorDone();
      } finally {
        if (abort.current === ac) abort.current = null;
        if (stateRef.current !== "off" && !ac.signal.aborted) setState("listening");
      }
    },
    [setState],
  );

  /** Type instead of speaking (noisy room, tests): same pipeline from the transcript on. */
  const say = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || stateRef.current === "off") return;
      queue.current?.cancel();
      abort.current?.abort();
      void handleTranscript(t);
    },
    [handleTranscript],
  );

  useEffect(() => {
    if (!opts.active) {
      queue.current?.cancel();
      abort.current?.abort();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("off");
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let recorderStartedAt = 0;
    let tick: ReturnType<typeof setInterval> | null = null;
    let speechStart: number | null = null;
    let lastSpeech = 0;
    let loudSince: number | null = null;
    let floor = 0.01;

    const startRecorder = () => {
      if (!stream || stopped) return;
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.start();
      recorderStartedAt = Date.now();
    };

    const transcribe = async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, "audio.webm");
        const res = await fetch("/api/ai/stt", { method: "POST", body: form });
        if (res.status === 503) {
          o.current.onError("Speech recognition isn’t set up on the server (STT_PROVIDER).");
          o.current.onStopListening();
          return;
        }
        const transcript = res.ok ? (((await res.json()) as { transcript?: string }).transcript ?? "").trim() : "";
        if (isPhantomTranscript(transcript)) {
          setState("listening");
          return;
        }
        await handleTranscript(transcript);
      } catch {
        setState("listening");
      }
    };

    const endUtterance = () => {
      const r = recorder;
      if (!r || r.state === "inactive") return;
      speechStart = null;
      r.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        startRecorder();
        void transcribe(blob);
      };
      r.stop();
    };

    const onTick = () => {
      const analyser = analyserRef;
      if (!analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / data.length);
      const now = Date.now();
      const s = stateRef.current;

      // Track room noise while nobody is talking so the threshold adapts.
      if (s === "listening" && rms < floor * 2.5) floor = floor * 0.95 + rms * 0.05;
      const threshold = Math.max(0.022, floor * 3);

      if (s === "thinking" || s === "transcribing") return;

      if (s === "speaking") {
        // Barge-in: sustained, clearly louder speech than the tutor's own echo.
        if (rms > Math.max(0.09, threshold * 2.5)) {
          loudSince ??= now;
          if (now - loudSince >= BARGE_IN_MS) {
            loudSince = null;
            queue.current?.cancel();
            abort.current?.abort();
            if (recorder && recorder.state !== "inactive") {
              recorder.onstop = () => startRecorder();
              recorder.stop();
            }
            speechStart = now;
            lastSpeech = now;
            setState("hearing");
          }
        } else loudSince = null;
        return;
      }

      if (rms > threshold) {
        speechStart ??= now;
        lastSpeech = now;
        if (s !== "hearing") setState("hearing");
      } else if (speechStart !== null) {
        if (now - lastSpeech > END_SILENCE_MS) {
          if (lastSpeech - speechStart >= MIN_SPEECH_MS) endUtterance();
          else {
            speechStart = null;
            setState("listening");
          }
        }
      } else if (s === "listening" && now - recorderStartedAt > IDLE_RESTART_MS && recorder?.state === "recording") {
        // Nobody spoke for a while: drop the silent audio instead of uploading it later.
        recorder.onstop = () => startRecorder();
        recorder.stop();
      }
    };

    let analyserRef: AnalyserNode | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("insecure", "SecurityError");
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyserRef = analyser;
        startRecorder();
        setState("listening");
        tick = setInterval(onTick, TICK_MS);
      } catch (e) {
        const name = (e as DOMException).name;
        o.current.onError(
          name === "SecurityError"
            ? "The microphone needs https:// or http://localhost. Open the app at http://localhost:3100."
            : name === "NotAllowedError"
              ? "The microphone is blocked. Allow it in the address bar’s site settings, then turn conversation back on."
              : name === "NotFoundError"
                ? "No microphone found."
                : "Could not start the microphone.",
        );
        o.current.onStopListening();
      }
    })();

    return () => {
      stopped = true;
      if (tick) clearInterval(tick);
      try {
        if (recorder && recorder.state !== "inactive") {
          recorder.onstop = null;
          recorder.stop();
        }
      } catch {
        /* already stopped */
      }
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      queue.current?.cancel();
      abort.current?.abort();
    };
  }, [opts.active, setState, handleTranscript]);

  return { state, say, tutorState };
}
