/** Mono 16-bit PCM WAV from Float32 audio chunks, downsampled (box average) to `outRate`. */
export function encodeWav(chunks: Float32Array[], inRate: number, outRate = 16000): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const flat = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    flat.set(c, o);
    o += c.length;
  }
  const ratio = inRate / outRate;
  const n = Math.max(0, Math.floor(total / ratio));
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(total, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += flat[j]!;
    const v = Math.max(-1, Math.min(1, sum / (b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buf);
  const str = (off: number, s: string) => [...s].forEach((ch, i) => view.setUint8(off + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, outRate, true);
  view.setUint32(28, outRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}
