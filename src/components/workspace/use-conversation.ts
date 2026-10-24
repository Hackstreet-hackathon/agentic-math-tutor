"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_STATE, isPhantomTranscript, type ConverseRequest, type TutorState } from "@/lib/ai/converse";
import { ChatError, streamConverse } from "@/lib/client/ai";
import { SpeechQueue } from "@/lib/client/speech-queue";
import { encodeWav } from "@/lib/client/wav";

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

const END_SILENCE_MS = 900;
const MIN_SPEECH_MS = 500;
const BARGE_WINDOW = 6; // ticks
const BARGE_VOTES = 3;
const PRE_ROLL_MS = 700;
const MAX_UTTERANCE_S = 30;
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
    let analyser: AnalyserNode | null = null;
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
    let speechStart: number | null = null;
    let lastSpeech = 0;
    const votes: boolean[] = [];
    let floor = 0.01;

    const onAudio = (chunk: Float32Array) => {
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
    const beginUtterance = () => {
      utterance = [...ring];
      utteranceSamples = ringSamples;
      speechEndSamples = ringSamples;
      ring.length = 0;
      ringSamples = 0;
    };

    const transcribe = async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, "audio.wav");
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
      const chunks = utterance;
      utterance = null;
      speechStart = null;
      if (!chunks || !ctx) return;
      void transcribe(encodeWav(trimTail(chunks, speechEndSamples + ctx.sampleRate * 0.25), ctx.sampleRate));
    };

    const onTick = () => {
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
        // Barge-in: speech has quiet gaps between syllables, so vote over a short window (3 of the last 6
        // ticks clearly louder than room noise) instead of requiring unbroken volume. Echo cancellation keeps
        // the tutor's own voice well below this level.
        votes.push(rms > Math.max(0.05, threshold * 2));
        if (votes.length > BARGE_WINDOW) votes.shift();
        if (votes.filter(Boolean).length >= BARGE_VOTES) {
          votes.length = 0;
          queue.current?.cancel();
          abort.current?.abort();
          beginUtterance();
          speechStart = now - (BARGE_WINDOW * TICK_MS) / 2;
          lastSpeech = now;
          setState("hearing");
        }
        return;
      }
      votes.length = 0;

      if (rms > threshold) {
        if (speechStart === null) {
          speechStart = now;
          beginUtterance();
        }
        lastSpeech = now;
        speechEndSamples = utteranceSamples;
        if (s !== "hearing") setState("hearing");
      } else if (speechStart !== null) {
        if (now - lastSpeech > END_SILENCE_MS) {
          if (lastSpeech - speechStart >= MIN_SPEECH_MS) endUtterance();
          else {
            utterance = null;
            speechStart = null;
            setState("listening");
          }
        }
      }
      // Very long monologue or a stuck noise source: send what we have.
      if (utterance && utteranceSamples > (ctx?.sampleRate ?? 48000) * MAX_UTTERANCE_S) endUtterance();
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("insecure", "SecurityError");
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

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
      capture?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      if (workletUrl) URL.revokeObjectURL(workletUrl);
      queue.current?.cancel();
      abort.current?.abort();
    };
  }, [opts.active, setState, handleTranscript]);

  return { state, say, tutorState };
}
