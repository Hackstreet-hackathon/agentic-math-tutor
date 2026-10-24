import { latexToSpeech } from "@/lib/notebook/latex-to-speech";
import { splitMath } from "@/components/workspace/math-text";
import { setConversationSpeaking } from "./speech-state";

/** What to actually say for a sentence that may contain $maths$ or light markdown. */
export function spokenText(text: string): string {
  return splitMath(text)
    .map((p) => (p.kind === "math" ? latexToSpeech(p.latex) : p.text))
    .join(" ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Item {
  text: string;
  /** Fetched as soon as the item is queued, so the next sentence is ready when the current one ends. */
  audio: Promise<Blob | null>;
}

const hasBrowserVoice = () => typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.getVoices().length > 0;
const reportAudioFailure = (why: string) => window.dispatchEvent(new CustomEvent("mn-audio-failed", { detail: why }));

/** OpenAI TTS usually answers in 1-3 s but sometimes stalls or errors; never let one slow sentence freeze the tutor. */
async function fetchTts(text: string): Promise<Blob | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("/api/ai/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(9000) });
      if (res.status === 503) {
        if (!hasBrowserVoice()) reportAudioFailure("Voice isn’t set up on the server (TTS_PROVIDER) and this browser has no voice of its own.");
        return null; // not configured: use the browser voice
      }
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) return blob;
      }
    } catch {
      /* timed out or network blip: try once more */
    }
  }
  if (!hasBrowserVoice()) reportAudioFailure("The voice service didn’t respond, so I’m showing my reply as text. Use the speaker button to try again.");
  return null;
}

/** Plays sentences one after another, prefetching audio; can be cancelled instantly (barge-in). */
export class SpeechQueue {
  private items: Item[] = [];
  private running = false;
  private gen = 0;
  private stopCurrent: (() => void) | null = null;
  private waiters: (() => void)[] = [];
  /** Called each time a sentence actually starts playing (its echo is about to reach the microphone). */
  onItemStart: ((firstAfterSilence: boolean) => void) | null = null;
  private playedSinceIdle = false;
  /** Everything spoken since the last reset, for "repeat that". */
  readonly spokenLog: string[] = [];

  get busy() {
    return this.running || this.items.length > 0;
  }

  enqueue(text: string) {
    const spoken = spokenText(text);
    if (!spoken) return;
    this.spokenLog.push(text);
    this.items.push({ text: spoken, audio: fetchTts(spoken) });
    setConversationSpeaking(true);
    void this.pump();
  }

  cancel() {
    this.gen++;
    this.items = [];
    this.stopCurrent?.();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.finish();
  }

  resetLog() {
    this.spokenLog.length = 0;
  }

  /** Resolves when nothing is queued or playing. */
  whenIdle(): Promise<void> {
    return this.busy ? new Promise((r) => this.waiters.push(r)) : Promise.resolve();
  }

  private finish() {
    this.running = false;
    if (this.items.length === 0) {
      this.playedSinceIdle = false;
      setConversationSpeaking(false);
      this.waiters.splice(0).forEach((w) => w());
    }
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    const gen = this.gen;
    while (this.items.length > 0 && gen === this.gen) {
      const item = this.items.shift()!;
      const blob = await item.audio;
      if (gen !== this.gen) return;
      await this.play(item.text, blob);
    }
    if (gen === this.gen) this.finish();
  }

  private play(text: string, blob: Blob | null): Promise<void> {
    return new Promise((resolve) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const done = () => {
          URL.revokeObjectURL(url);
          this.stopCurrent = null;
          resolve();
        };
        let finished = false;
        const end = () => {
          finished = true;
          done();
        };
        audio.onended = end;
        audio.onerror = () => {
          if (!hasBrowserVoice()) reportAudioFailure("This browser couldn’t play the tutor’s voice.");
          end();
        };
        this.stopCurrent = () => {
          audio.pause();
          end();
        };
        // Autoplay can be refused until the page has seen a click: tell the UI and retry on the first one.
        const attempt = () =>
          audio.play().catch((err: unknown) => {
            if ((err as Error)?.name === "NotAllowedError" && !finished) {
              window.dispatchEvent(new Event("mn-audio-blocked"));
              const retry = () => {
                window.removeEventListener("pointerdown", retry);
                window.removeEventListener("keydown", retry);
                if (!finished) attempt();
              };
              window.addEventListener("pointerdown", retry);
              window.addEventListener("keydown", retry);
            } else end();
          });
        this.onItemStart?.(!this.playedSinceIdle);
        this.playedSinceIdle = true;
        void attempt();
      } else if (hasBrowserVoice()) {
        this.onItemStart?.(!this.playedSinceIdle);
        this.playedSinceIdle = true;
        const u = new SpeechSynthesisUtterance(text);
        u.onend = u.onerror = () => {
          this.stopCurrent = null;
          resolve();
        };
        this.stopCurrent = () => {
          window.speechSynthesis.cancel();
          resolve();
        };
        window.speechSynthesis.speak(u);
      } else resolve();
    });
  }
}
