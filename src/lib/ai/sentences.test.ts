import { describe, expect, it } from "vitest";
import { SentenceStream } from "./sentences";

const run = (chunks: string[]) => {
  const s = new SentenceStream();
  const out: string[] = [];
  for (const c of chunks) out.push(...s.push(c));
  out.push(...s.flush());
  return { out, state: s.state };
};

describe("SentenceStream", () => {
  it("emits sentences as they complete across chunk boundaries", () => {
    expect(run(["Good ques", "tion. Let's fa", "ctor it! Ready", "?"]).out).toEqual(["Good question.", "Let's factor it!", "Ready?"]);
  });

  it("does not split decimals, abbreviations or inline maths", () => {
    expect(run(["It is 3.14 roughly, e.g. pi. Next $x = 2.5. y$ here."]).out).toEqual(["It is 3.14 roughly, e.g. pi.", "Next $x = 2.5. y$ here."]);
  });

  it("holds back and parses the hidden state trailer, even when split", () => {
    const r = run(["What do you get? <", "<STATE {\"stage\":\"check\",", "\"understood\":false}>>"]);
    expect(r.out).toEqual(["What do you get?"]);
    expect(r.state).toEqual({ stage: "check", understood: false });
  });

  it("does not swallow a lone < that is not a trailer", () => {
    expect(run(["Is x < 3 true? Yes."]).out).toEqual(["Is x < 3 true?", "Yes."]);
  });

  it("flushes a final sentence without punctuation", () => {
    expect(run(["Try subtracting three"]).out).toEqual(["Try subtracting three"]);
  });
});
