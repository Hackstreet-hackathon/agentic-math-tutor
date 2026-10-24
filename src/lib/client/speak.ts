/** Speak a short line: server TTS when configured, otherwise the browser's speech synthesis. */
let current: { stop: () => void } | null = null;

export function isSpeaking(): boolean {
  return current !== null;
}

export function stopSpeaking() {
  current?.stop();
}

export async function speak(text: string): Promise<void> {
  if (!text.trim() || typeof window === "undefined") return;
  stopSpeaking();

  const fallback = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const me = { stop: () => window.speechSynthesis.cancel() };
    u.onend = u.onerror = () => {
      if (current === me) current = null;
    };
    current = me;
    window.speechSynthesis.speak(u);
  };

  try {
    const res = await fetch("/api/ai/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) return fallback();
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    const me = {
      stop: () => {
        audio.pause();
        URL.revokeObjectURL(url);
        if (current === me) current = null;
      },
    };
    audio.onended = audio.onerror = me.stop;
    current = me;
    await audio.play();
  } catch {
    current = null;
    fallback();
  }
}
