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

  if (STT_PROVIDER === "groq") {
    try {
      const form = new FormData();
      form.append("file", audioBlob, "audio.webm");
      form.append("model", "whisper-large-v3-turbo");
      form.append("response_format", "json");

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env().GROQ_API_KEY ?? ""}`,
        },
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
