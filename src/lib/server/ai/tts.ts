import { env } from "../env";

/** Returns a Response streaming audio/mpeg, or null when TTS is not configured. */
export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  const { TTS_PROVIDER } = env();

  if (TTS_PROVIDER === "none") return null;

  if (TTS_PROVIDER === "openai") {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env().OPENAI_API_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env().OPENAI_TTS_MODEL ?? "tts-1",
          voice: env().OPENAI_TTS_VOICE ?? "alloy",
          input: text,
        }),
        signal,
      });

      if (!res.ok) return null;
      return res;
    } catch {
      return null;
    }
  }

  return null;
}
