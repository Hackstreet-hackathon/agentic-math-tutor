"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_STATE, isPhantomTranscript, type ConverseRequest, type TutorState } from "@/lib/ai/converse";
import { ChatError, streamConverse } from "@/lib/client/ai";
import { isEcho } from "@/lib/client/echo";
import { SpeechQueue } from "@/lib/client/speech-queue";
import { setConversationActive } from "@/lib/client/speech-state";
import { looksUnfinished } from "@/lib/client/utterance";
import { Vad, type VadState } from "@/lib/client/vad";
import { encodeWav } from "@/lib/client/wav";

export type ConvoState = "off" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

/** Something the step-checker noticed while the student works; the tutor raises it in the conversation. */
export interface StudyEvent {
  kind: "mistake" | "fixed";
  step: string;
  hint?: string;
  whatsWrong?: string;
}

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
  /** Non-error hint for the user (e.g. "click once to allow audio"); null clears it. */
  onNotice?: (message: string | null) => void;
}

/** Keep only the first `keep` samples (drops the silence that ended the turn, so less audio is uploaded). */
function trimTail(chunks: Float32Array[], keep: number): Float32Array[] {
  const out: Float32Array[] = [];
  let left = Math.floor(keep);
  for (const c of chunks) {
    if (left <= 0) break;
    out.push(c.length <= left ? c : c.subarray(0, left));
    left -= c.length;
  }
  return out;
}

const PRE_ROLL_MS = 700;
const MAX_UTTERANCE_S = 30;
const TICK_MS = 80;
/** How long to wait for the rest of a sentence that trails off ("How do I…") before answering what we have. */
const HOLD_MS = 1600;

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
  /** A mistake/fix the checker noticed while the student was talking or the tutor was mid-answer. */
  const waitingEvent = useRef<StudyEvent | null>(null);
  const runEvent = useRef<(e: StudyEvent) => void>(() => {});
  const setState = useCallback((s: ConvoState) => {
    stateRef.current = s;
    setStateRaw(s);
    if (s === "listening" && waitingEvent.current) {
      const e = waitingEvent.current;
      waitingEvent.current = null;
      // Let the "listening" state settle first so it never cuts into something that just started.
      setTimeout(() => runEvent.current(e), 400);
    }
  }, []);

  const queue = useRef<SpeechQueue | null>(null);
  const abort = useRef<AbortController | null>(null);
  const tutorState = useRef<TutorState>(IDLE_STATE);
  /** What the tutor said recently, to recognise (and ignore) its own voice coming back through the mic. */
  const tutorSaid = useRef<string[]>([]);
  /** All the "is the student talking?" decisions (noise floor, echo, interruptions); unit-tested on its own. */
  const vad = useRef(new Vad());
  const sttAbort = useRef<AbortController | null>(null);
  const conversationId = useRef<string | null>(opts.conversationId);
  useEffect(() => {
    conversationId.current = opts.conversationId;
  }, [opts.conversationId]);

  /**
   * One full turn. `transcript` is what the student said; `mode` is set when the tutor speaks first
   * ("opening": listening just started, "lasso": the student circled something). Answers are spoken only
   * while listening is on; otherwise the same turn runs as text in the panel.
   */
  const handleTranscript = useCallback(
    async (transcript: string | null, mode?: "opening" | "lasso" | "event", event?: StudyEvent) => {
      const cur = o.current;
      if (!cur.pageId) return;
      if (!queue.current) {
        queue.current = new SpeechQueue();
        queue.current.onItemStart = (first) => first && vad.current.tutorSentenceStarted(Date.now());
      }
      const q = queue.current;
      const voiceOn = stateRef.current !== "off";
      const set = (s: ConvoState) => voiceOn && setState(s);
      const ac = new AbortController();
      abort.current = ac;
      q.resetLog();

      set("thinking");
      if (transcript !== null) cur.onUser(transcript);
      let text = "";
      let started = false;
      const begin = () => {
        if (started) return;
        started = true;
        cur.onTutorStart();
      };
      try {
        const payload = mode === "opening" || mode === "event" ? null : await cur.getPayload();
        await streamConverse(
          {
            notebookId: cur.notebookId,
            pageId: cur.pageId,
            conversationId: conversationId.current,
            ...(mode === "opening" ? { opening: true } : mode === "lasso" ? { lasso: true } : mode === "event" ? { event } : { transcript: transcript ?? "" }),
            selection: payload?.selection ?? null,
            image: payload?.image ?? null,
            recognizedHandwriting: payload?.recognizedHandwriting,
            tutorState: tutorState.current,
          },
          {
            onMeta: (m) => {
              conversationId.current = m.conversationId;
              cur.onConversationId(m.conversationId);
            },
            onAck: (t) => {
              tutorSaid.current = [...tutorSaid.current, t].slice(-8);
              begin();
              text = t;
              cur.onTutorText(text);
              if (!voiceOn) return;
              q.enqueue(t);
              set("speaking");
            },
            onSentence: (t) => {
              tutorSaid.current = [...tutorSaid.current, t].slice(-8);
              begin();
              text += (text ? " " : "") + t;
              cur.onTutorText(text);
              if (voiceOn) q.enqueue(t);
              set("speaking");
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
        if (voiceOn) {
          await q.whenIdle();
          // Only when the tutor finished by itself; if the student cut it off, their speech must not be muted.
          if (!ac.signal.aborted) vad.current.tutorStopped(Date.now());
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          q.cancel();
          cur.onError((e as ChatError).message || "Something went wrong.");
        }
        if (started) cur.onTutorDone();
      } finally {
        if (abort.current === ac) abort.current = null;
        if (voiceOn && stateRef.current !== "off" && !ac.signal.aborted) setState("listening");
      }
    },
    [setState],
  );

  /** The checker noticed a mistake / a fix: the tutor brings it up in the conversation (spoken and in the panel). */
  const announce = useCallback(
    (event: StudyEvent) => {
      if (stateRef.current === "off") return;
      // Never talk over the student or interrupt an answer: wait for a quiet moment (the newest event wins).
      if (stateRef.current !== "listening") {
        waitingEvent.current = event;
        return;
      }
      void handleTranscript(null, "event", event);
    },
    [handleTranscript],
  );
  useEffect(() => {
    runEvent.current = (e) => {
      if (stateRef.current === "listening") void handleTranscript(null, "event", e);
      else waitingEvent.current = e;
    };
  }, [handleTranscript]);

  /** Say a message again (also the way to get sound after the browser blocked autoplay: it is a click). */
  const replay = useCallback((text: string) => {
    queue.current ??= new SpeechQueue();
    queue.current.cancel();
    queue.current.resetLog();
    queue.current.enqueue(text);
  }, []);

  /** The student circled something: the tutor takes the lead and asks about it (spoken when listening is on). */
  const lasso = useCallback(() => {
    queue.current?.cancel();
    abort.current?.abort();
    void handleTranscript(null, "lasso");
  }, [handleTranscript]);

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

  const greeted = useRef(false);

  // The voice failed or isn't available: say so instead of staying silent.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = (e: Event) => {
      o.current.onNotice?.((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => o.current.onNotice?.(null), 8000);
    };
    window.addEventListener("mn-audio-failed", failed);
    return () => {
      window.removeEventListener("mn-audio-failed", failed);
      clearTimeout(timer);
    };
  }, []);

  // Sound the browser refused to play until the page gets a click.
  useEffect(() => {
    const blocked = () => {
      o.current.onNotice?.("Click anywhere on the page once to allow sound.");
      window.addEventListener("pointerdown", () => o.current.onNotice?.(null), { once: true });
    };
    window.addEventListener("mn-audio-blocked", blocked);
    return () => window.removeEventListener("mn-audio-blocked", blocked);
  }, []);

  useEffect(() => {
    setConversationActive(opts.active);
    return () => setConversationActive(false);
  }, [opts.active]);

  useEffect(() => {
    if (!opts.active) {
      greeted.current = false;
      queue.current?.cancel();
      abort.current?.abort();
      sttAbort.current?.abort();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("off");
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let capture: AudioWorkletNode | null = null;
    let workletUrl: string | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    // Raw audio is always flowing into a short rolling buffer (the "pre-roll"). When speech starts, that
    // buffer becomes the start of the utterance, so the first syllable is never lost and nothing the tutor
    // said earlier is ever uploaded.
    const ring: Float32Array[] = [];
    let ringSamples = 0;
    let utterance: Float32Array[] | null = null;
    let utteranceSamples = 0;
    /** Samples captured up to the last moment of speech; everything after is the silence that ended the turn. */
    let speechEndSamples = 0;
    /** The clip currently being transcribed, kept so a continuation after a thinking-pause can be merged into it. */
    let pending: Float32Array[] | null = null;
    vad.current = new Vad();
    // `localStorage.setItem("mn-debug","1")` logs the detector's decisions to the console.
    let debug = false;
    try {
      debug = localStorage.getItem("mn-debug") === "1";
    } catch {
      /* ignore */
    }

    // Loudness is measured over every sample since the last check (a short snapshot misses most of the audio).
    let sumSq = 0;
    let sampleCount = 0;
    const onAudio = (chunk: Float32Array) => {
      for (let i = 0; i < chunk.length; i++) sumSq += chunk[i]! * chunk[i]!;
      sampleCount += chunk.length;
      if (utterance) {
        utterance.push(chunk);
        utteranceSamples += chunk.length;
        return;
      }
      ring.push(chunk);
      ringSamples += chunk.length;
      const keep = ((ctx?.sampleRate ?? 48000) * PRE_ROLL_MS) / 1000;
      while (ring.length > 1 && ringSamples - ring[0]!.length >= keep) ringSamples -= ring.shift()!.length;
    };
    const beginUtterance = (carry: Float32Array[] = []) => {
      utterance = [...carry, ...ring];
      utteranceSamples = utterance.reduce((n, c) => n + c.length, 0);
      speechEndSamples = utteranceSamples;
      ring.length = 0;
      ringSamples = 0;
    };

    const transcribe = async (blob: Blob) => {
      setState("transcribing");
      const ac = new AbortController();
      sttAbort.current = ac;
      try {
        const form = new FormData();
        form.append("audio", blob, "audio.wav");
        const res = await fetch("/api/ai/stt", { method: "POST", body: form, signal: ac.signal });
        if (res.status === 503) {
          o.current.onError("Speech recognition isn’t set up on the server (STT_PROVIDER).");
          o.current.onStopListening();
          return;
        }
        const transcript = res.ok ? (((await res.json()) as { transcript?: string }).transcript ?? "").trim() : "";
        // Silence/noise hallucinations, and the tutor's own voice coming back through the speakers.
        if (isPhantomTranscript(transcript) || isEcho(transcript, tutorSaid.current)) {
          pending = null;
          setState("listening");
          return;
        }
        if (looksUnfinished(transcript)) {
          // Probably mid-thought: give the rest a moment to arrive (it is merged if it does).
          const waited = await new Promise<boolean>((resolve) => {
            const t = setTimeout(() => resolve(true), HOLD_MS);
            ac.signal.addEventListener("abort", () => (clearTimeout(t), resolve(false)), { once: true });
          });
          if (!waited) return;
        }
        pending = null;
        await handleTranscript(transcript);
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // the student kept talking: that path owns the state
        pending = null;
        setState("listening");
      }
    };

    const endUtterance = () => {
      const chunks = utterance;
      utterance = null;
      if (!chunks || !ctx) return;
      const clip = trimTail(chunks, speechEndSamples + ctx.sampleRate * 0.25);
      pending = clip;
      void transcribe(encodeWav(clip, ctx.sampleRate));
    };

    const onTick = () => {
      if (sampleCount === 0 || stateRef.current === "off") return;
      const rms = Math.sqrt(sumSq / sampleCount);
      sumSq = 0;
      sampleCount = 0;
      const s = stateRef.current;

      const ev = vad.current.tick(rms, Date.now(), s as VadState);
      if (debug) console.debug(`[vad] ${s} rms=${rms.toFixed(3)} thr=${vad.current.threshold.toFixed(3)} ${ev ?? ""}`);
      switch (ev) {
        case "barge_in": // the student talked over the tutor
          queue.current?.cancel();
          abort.current?.abort();
          beginUtterance();
          setState("hearing");
          break;
        case "resume": {
          // The student is talking again. While their clip is still being transcribed this is a continuation
          // after a thinking-pause, so merge it; once the tutor is already working it is a new utterance.
          const carry = s === "transcribing" && pending ? pending : [];
          sttAbort.current?.abort();
          abort.current?.abort();
          queue.current?.cancel();
          pending = null;
          beginUtterance(carry);
          setState("hearing");
          break;
        }
        case "start":
          beginUtterance();
          setState("hearing");
          break;
        case "speech":
          speechEndSamples = utteranceSamples;
          if (s !== "hearing") setState("hearing");
          break;
        case "end":
          endUtterance();
          break;
        case "discard": // a cough or click
          utterance = null;
          setState("listening");
          break;
      }
      // Very long monologue or a stuck noise source: send what we have.
      if (utterance && utteranceSamples > (ctx?.sampleRate ?? 48000) * MAX_UTTERANCE_S) {
        endUtterance();
        vad.current.reset();
      }
    };

    // The tutor speaks first, right away: it does not wait for (or depend on) the microphone permission.
    setState("listening");
    if (!greeted.current) {
      greeted.current = true;
      void handleTranscript(null, "opening");
    }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("insecure", "SecurityError");
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        // Browsers may keep audio suspended until the page has seen a click; resume on the first one.
        const resumeAudio = () => {
          void ctx?.resume().then(() => {
            if (ctx?.state === "running") o.current.onNotice?.(null);
          });
        };
        if (ctx.state === "suspended") {
          o.current.onNotice?.("Click anywhere on the page once so the tutor can listen and speak.");
          window.addEventListener("pointerdown", resumeAudio, { once: true });
          window.addEventListener("keydown", resumeAudio, { once: true });
          resumeAudio();
        }
        const source = ctx.createMediaStreamSource(stream);

        const code = "class C extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('mn-capture',C)";
        workletUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(workletUrl);
        if (stopped) return;
        capture = new AudioWorkletNode(ctx, "mn-capture");
        capture.port.onmessage = (e) => onAudio(e.data as Float32Array);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(capture);
        capture.connect(mute).connect(ctx.destination);

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
        // No microphone is not the end of the conversation: the tutor still talks, and you can type to it.
        o.current.onNotice?.(null);
      }
    })();

    return () => {
      stopped = true;
      if (tick) clearInterval(tick);
      capture?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      if (workletUrl) URL.revokeObjectURL(workletUrl);
      queue.current?.cancel();
      abort.current?.abort();
      sttAbort.current?.abort();
    };
  }, [opts.active, setState, handleTranscript]);

  return { state, say, lasso, announce, replay, tutorState };
}
