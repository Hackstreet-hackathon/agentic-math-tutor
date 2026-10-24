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

async function fetchTts(text: string): Promise<Blob | null> {
  try {
    const res = await fetch("/api/ai/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** Plays sentences one after another, prefetching audio; can be cancelled instantly (barge-in). */
export class SpeechQueue {
  private items: Item[] = [];
  private running = false;
  private gen = 0;
  private stopCurrent: (() => void) | null = null;
  private waiters: (() => void)[] = [];
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
        audio.onended = done;
        audio.onerror = done;
        this.stopCurrent = () => {
          audio.pause();
          done();
        };
        audio.play().catch(done);
      } else if ("speechSynthesis" in window) {
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
