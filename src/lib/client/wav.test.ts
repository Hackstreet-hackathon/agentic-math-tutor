import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

describe("encodeWav", () => {
  it("writes a valid 16 kHz mono header and downsamples", async () => {
    const tone = new Float32Array(48000).map((_, i) => Math.sin((i / 48000) * 2 * Math.PI * 440));
    const blob = encodeWav([tone.slice(0, 20000), tone.slice(20000)], 48000);
    const view = new DataView(await blob.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(16000 * 2); // one second of 16-bit samples
    expect(blob.type).toBe("audio/wav");
    // Not silence, and clipped to range.
    const peak = Math.max(...new Int16Array(await blob.arrayBuffer(), 44).map(Math.abs));
    expect(peak).toBeGreaterThan(20000);
  });

  it("handles an empty recording", async () => {
    expect((await encodeWav([], 48000).arrayBuffer()).byteLength).toBe(44);
  });
});
