/**
 * Voice-activity decisions for the always-listening tutor, kept free of audio APIs so they can be tested.
 * Feed it the microphone level (RMS, 0..1) every tick together with what the app is doing, and it says
 * when the student started talking, finished, interrupted the tutor, or carried on after a pause.
 */
export type VadState = "listening" | "hearing" | "transcribing" | "thinking" | "speaking";
export type VadEvent =
  /** Speech began (the caller should start capturing, using its pre-roll). */
  | "start"
  /** Speech is continuing (keep the "hearing" state and note the last speech sample). */
  | "speech"
  /** The student stopped; the utterance is complete. */
  | "end"
  /** A short noise burst (cough, click): throw the capture away. */
  | "discard"
  /** The student started talking over the tutor. */
  | "barge_in"
  /** The student started talking again while their last clip was being transcribed. */
  | "resume"
  | null;

export interface VadConfig {
  tickMs: number;
  endSilenceMs: number;
  minSpeechMs: number;
  noiseWindow: number;
  /** Ticks of level history needed before speech can be declared (measures the room first). */
  warmup: number;
  bargeWindow: number;
  bargeVotes: number;
  bargeGraceMs: number;
  echoTailMs: number;
}

export const VAD_DEFAULTS: VadConfig = {
  tickMs: 80,
  endSilenceMs: 1000,
  minSpeechMs: 500,
  noiseWindow: 40,
  warmup: 8,
  bargeWindow: 6,
  bargeVotes: 3,
  bargeGraceMs: 350,
  echoTailMs: 600,
};

const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};
const loudCount = (xs: boolean[]) => xs.filter(Boolean).length;

export class Vad {
  private noise: number[] = [];
  private echo: number[] = [];
  private votes: boolean[] = [];
  private resumeVotes: boolean[] = [];
  private recent: boolean[] = [];
  private speechStart: number | null = null;
  private lastSpeech = 0;
  private graceUntil = 0;
  private quietUntil = 0;

  constructor(private cfg: VadConfig = VAD_DEFAULTS) {}

  /** Level above which something counts as speech: just above the room noise. */
  get threshold() {
    const floor = this.noise.length >= this.cfg.warmup ? percentile(this.noise, 0.2) : 0.01;
    return Math.max(0.022, floor * 2.2);
  }

  /** A tutor sentence just started playing: its echo is about to reach the mic, so measure before judging. */
  tutorSentenceStarted(now: number) {
    this.graceUntil = now + this.cfg.bargeGraceMs;
  }

  /** The tutor finished talking: ignore the mic briefly while its voice still rings in the room. */
  tutorStopped(now: number) {
    this.quietUntil = now + this.cfg.echoTailMs;
  }

  /** Forget an in-progress utterance (the caller threw its capture away). */
  reset() {
    this.speechStart = null;
    this.recent = [];
    this.votes = [];
    this.resumeVotes = [];
  }

  tick(rms: number, now: number, state: VadState): VadEvent {
    const threshold = this.threshold;

    if (state !== "speaking") {
      this.noise.push(rms);
      if (this.noise.length > this.cfg.noiseWindow) this.noise.shift();
    }

    if (state === "speaking") {
      // The mic also hears the tutor, so the student must be clearly louder than that echo (its median level),
      // and speech has quiet gaps, so vote over a short window instead of asking for unbroken volume.
      this.echo.push(rms);
      if (this.echo.length > 25) this.echo.shift();
      const level = Math.max(0.05, threshold * 2, percentile(this.echo, 0.5) * 2.5);
      this.votes.push(now > this.graceUntil && rms > level);
      if (this.votes.length > this.cfg.bargeWindow) this.votes.shift();
      if (loudCount(this.votes) >= this.cfg.bargeVotes) {
        this.votes = [];
        this.speechStart = now - (this.cfg.bargeWindow * this.cfg.tickMs) / 2;
        this.lastSpeech = now;
        return "barge_in";
      }
      return null;
    }
    this.votes = [];
    this.echo = [];

    // The tutor's echo tail is ignored, but never once the student has started talking.
    if (now < this.quietUntil && this.speechStart === null) return null;

    if (state === "transcribing" || state === "thinking") {
      this.resumeVotes.push(rms > threshold * 1.5);
      if (this.resumeVotes.length > 5) this.resumeVotes.shift();
      if (loudCount(this.resumeVotes) >= 3) {
        this.resumeVotes = [];
        this.speechStart = now;
        this.lastSpeech = now;
        return "resume";
      }
      return null;
    }
    this.resumeVotes = [];

    const loud = rms > threshold;
    if (loud) {
      if (this.speechStart === null) {
        // Two of the last three ticks must be loud: a single pop is not speech. Wait for the room measurement first.
        this.recent.push(true);
        if (this.recent.length > 3) this.recent.shift();
        if (this.noise.length < this.cfg.warmup || loudCount(this.recent) < 2) return null;
        this.speechStart = now;
        this.lastSpeech = now;
        this.recent = [];
        return "start";
      }
      this.lastSpeech = now;
      return "speech";
    }

    if (this.speechStart === null) {
      this.recent.push(false);
      if (this.recent.length > 3) this.recent.shift();
      return null;
    }
    if (now - this.lastSpeech > this.cfg.endSilenceMs) {
      const longEnough = this.lastSpeech - this.speechStart >= this.cfg.minSpeechMs;
      this.speechStart = null;
      return longEnough ? "end" : "discard";
    }
    return null;
  }
}
