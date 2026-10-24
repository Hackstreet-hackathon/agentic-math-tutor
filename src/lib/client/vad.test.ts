import { describe, expect, it } from "vitest";
import { Vad, type VadEvent, type VadState } from "./vad";

/** Run a level sequence (rms per 80 ms tick) and collect the events with the tick they fired on. */
function run(levels: number[], opts: { state?: VadState | ((i: number) => VadState); vad?: Vad; startAt?: number } = {}) {
  const vad = opts.vad ?? new Vad();
  const events: { i: number; e: NonNullable<VadEvent> }[] = [];
  levels.forEach((rms, i) => {
    const s = typeof opts.state === "function" ? opts.state(i) : (opts.state ?? "listening");
    const e = vad.tick(rms, (opts.startAt ?? 0) + i * 80, s);
    if (e) events.push({ i, e });
  });
  return { events, vad };
}
const rep = (v: number, n: number) => Array<number>(n).fill(v);
const kinds = (r: { events: { e: string }[] }) => r.events.map((x) => x.e);
/** Speech-like levels: loud syllables with quiet gaps between them. */
const speech = (ticks: number, loud = 0.12, gap = 0.01) => Array.from({ length: ticks }, (_, i) => (i % 4 === 3 ? gap : loud));

describe("Vad: listening", () => {
  it("starts on speech and ends after a second of silence, once", () => {
    const r = run([...rep(0.005, 15), ...speech(20), ...rep(0.005, 20)], { state: (i) => (i >= 15 && i < 50 ? "hearing" : "listening") });
    const k = kinds(r);
    expect(k[0]).toBe("start");
    expect(k.filter((x) => x === "end")).toHaveLength(1);
    expect(k).not.toContain("discard");
  });

  it("does not end mid-sentence on the short gaps between words", () => {
    const r = run([...rep(0.005, 15), ...speech(30)], { state: "hearing" });
    expect(kinds(r)).not.toContain("end");
  });

  it("throws away a cough or click instead of sending it to speech recognition", () => {
    const r = run([...rep(0.005, 15), ...rep(0.3, 4), ...rep(0.005, 20)]);
    expect(kinds(r)).toEqual(["start", "speech", "speech", "discard"]);
  });

  it("ignores a single pop", () => {
    expect(kinds(run([...rep(0.005, 15), 0.4, ...rep(0.005, 20)]))).toEqual([]);
  });

  it("learns constant room noise instead of hearing it as speech forever", () => {
    // 30 s of fan noise at 0.03 (above the quiet-room threshold): must not produce a never-ending utterance.
    const r = run(rep(0.03, 375));
    const ends = r.events.filter((x) => x.e === "end" || x.e === "discard");
    expect(r.events.length).toBeLessThanOrEqual(3);
    expect(r.events.filter((x) => x.e === "speech").length).toBeLessThan(5);
    expect(ends.length).toBeLessThanOrEqual(1);
  });

  it("still hears speech on top of that noise", () => {
    const noise = rep(0.03, 60);
    const talk = speech(24, 0.16, 0.03);
    const r = run([...noise, ...talk, ...rep(0.03, 20)], { state: (i) => (i >= 60 && i < 84 ? "hearing" : "listening") });
    expect(kinds(r)[0]).toBe("start");
    expect(kinds(r)).toContain("end");
  });

  it("waits for the room measurement before declaring speech right at start-up", () => {
    expect(kinds(run(rep(0.3, 5)))).toEqual([]);
  });
});

describe("Vad: while the tutor speaks", () => {
  it("does not treat the tutor's own echo as an interruption", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    vad.tutorSentenceStarted(15 * 80);
    const r = run(rep(0.06, 40), { vad, state: "speaking", startAt: 15 * 80 });
    expect(kinds(r)).toEqual([]);
  });

  it("does not fire during the grace period after a sentence starts, even for loud sound", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    vad.tutorSentenceStarted(1200);
    const r = run(rep(0.3, 5), { vad, state: "speaking", startAt: 1200 });
    expect(kinds(r)).toEqual([]);
  });

  it("lets the student interrupt with natural speech (gaps and all)", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    vad.tutorSentenceStarted(1200);
    const echo = rep(0.04, 20);
    const r = run([...echo, ...speech(12, 0.2, 0.02)], { vad, state: "speaking", startAt: 2000 });
    expect(kinds(r)[0]).toBe("barge_in");
    expect(r.events[0]!.i).toBeGreaterThanOrEqual(20); // not before the student actually spoke
  });

  it("stays quiet briefly after the tutor stops so its echo tail is not heard as speech", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    vad.tutorStopped(1200);
    const r = run(rep(0.2, 6), { vad, startAt: 1200 });
    expect(kinds(r)).toEqual([]);
    const later = run(rep(0.2, 6), { vad, startAt: 2000 });
    expect(kinds(later)[0]).toBe("start");
  });
});

describe("Vad: after the student stops", () => {
  it("reports a continuation while the clip is still being transcribed", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    const r = run([...rep(0.005, 5), ...rep(0.12, 5)], { vad, state: "transcribing", startAt: 1200 });
    expect(kinds(r)).toEqual(["resume"]);
  });

  it("ignores a lone noise while thinking", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    expect(kinds(run([0.3, ...rep(0.005, 8)], { vad, state: "thinking", startAt: 1200 }))).toEqual([]);
  });

  it("does not swallow the student's words when they cut the tutor off", () => {
    const vad = new Vad();
    run(rep(0.005, 15), { vad });
    vad.tutorSentenceStarted(1200);
    const echo = rep(0.02, 10);
    // interruption detected, then the tutor is cancelled (which would normally start the echo-tail quiet period)
    const r1 = run([...echo, ...rep(0.25, 4)], { vad, state: "speaking", startAt: 2000 });
    expect(kinds(r1)).toContain("barge_in");
    vad.tutorStopped(3000);
    const r2 = run(speech(10, 0.2, 0.05), { vad, state: "hearing", startAt: 3000 });
    expect(kinds(r2)).toContain("speech");
  });
});
