/**
 * Turns a token stream into whole sentences for text-to-speech, and strips the hidden teaching-state trailer
 * (`<<STATE {...}>>`) the tutor appends to its reply so it is never spoken.
 */
const ABBREVIATIONS = /\b(e\.g|i\.e|vs|etc|mr|mrs|ms|dr|prof|fig|eq|approx|st)\.$/i;
const TRAILER = "<<STATE";

export class SentenceStream {
  private buf = "";
  private trailer = "";
  private inTrailer = false;

  /** The raw trailer JSON once the closing `>>` has been seen. */
  get state(): unknown {
    const m = /^<<STATE\s*([\s\S]*?)\s*>>/.exec(this.trailer);
    if (!m) return null;
    try {
      return JSON.parse(m[1]!);
    } catch {
      return null;
    }
  }

  /** Feed a chunk; returns any sentences that are now complete. */
  push(chunk: string): string[] {
    if (this.inTrailer) {
      this.trailer += chunk;
      return [];
    }
    // Re-attach text held back last time (it may or may not have been the start of a trailer).
    this.buf += this.trailer + chunk;
    this.trailer = "";

    const t = this.buf.indexOf(TRAILER);
    if (t >= 0) {
      this.trailer = this.buf.slice(t);
      this.buf = this.buf.slice(0, t);
      this.inTrailer = true;
    } else {
      // Hold back a possible partial "<<STATE" at the very end of the buffer.
      for (let k = Math.min(TRAILER.length - 1, this.buf.length); k > 0; k--) {
        if (TRAILER.startsWith(this.buf.slice(-k))) {
          this.trailer = this.buf.slice(-k);
          this.buf = this.buf.slice(0, -k);
          break;
        }
      }
    }
    return this.drain(false);
  }

  /** End of stream: emit whatever is left. */
  flush(): string[] {
    if (!this.inTrailer && this.trailer && !this.trailer.startsWith(TRAILER)) {
      // The held-back text turned out not to be a trailer.
      this.buf += this.trailer;
      this.trailer = "";
    }
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const end = this.findEnd(final);
      if (end < 0) break;
      const sentence = this.buf.slice(0, end).trim();
      this.buf = this.buf.slice(end);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** Index just after the first complete sentence in the buffer, or -1. */
  private findEnd(final: boolean): number {
    let dollars = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i]!;
      if (c === "$") dollars++;
      if (dollars % 2 === 1) continue; // inside $...$
      if (c === "\n") return i + 1;
      if (c === "." || c === "!" || c === "?" || c === "…") {
        const next = this.buf[i + 1];
        if (next === undefined) {
          if (final) return i + 1;
          return -1; // might be a decimal or an abbreviation continuing
        }
        if (!/\s/.test(next)) continue; // 3.14, x.y
        if (c === "." && ABBREVIATIONS.test(this.buf.slice(Math.max(0, i - 6), i + 1))) continue;
        return i + 1;
      }
    }
    return final && this.buf.trim() ? this.buf.length : -1;
  }
}
