import { env } from "../env";

export interface STTResult {
  transcript: string;
}

/** Returns null when STT is not configured server-side (use browser fallback). */
export async function transcribeAudio(
  audioBlob: Blob,
  signal?: AbortSignal,
): Promise<STTResult | null> {
  const { STT_PROVIDER } = env();

  if (STT_PROVIDER === "none") return null;

  if (STT_PROVIDER === "openai") {
    try {
      const e = env();
      const form = new FormData();
      form.append("file", audioBlob, (audioBlob as File).name || "audio.webm");
      form.append("model", e.OPENAI_STT_MODEL ?? "whisper-1");
      form.append("response_format", "json");
      // Whisper hallucinates text on silence; nudge it toward maths speech.
      form.append("prompt", "A student asking a maths question aloud.");

      const res = await fetch(`${e.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${e.OPENAI_API_KEY ?? ""}` },
        body: form,
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { text: string };
      return { transcript: json.text };
    } catch {
      return null;
    }
  }

  return null;
}
