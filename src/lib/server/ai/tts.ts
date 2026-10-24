import { env } from "../env";
import { HttpError } from "../http";

/** Returns a Response streaming audio/mpeg, or null when TTS is not configured. Throws a 502 when the provider fails. */
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
          // Only the gpt-4o-*-tts models accept speaking-style instructions.
          ...(env().OPENAI_TTS_STYLE && /gpt-4o/.test(env().OPENAI_TTS_MODEL ?? "") ? { instructions: env().OPENAI_TTS_STYLE } : {}),
        }),
        signal: signal ?? AbortSignal.timeout(20_000),
      });

      if (!res.ok) throw new HttpError(502, `The voice service failed (${res.status}).`, "tts_failed");
      return res;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, "The voice service could not be reached.", "tts_unreachable");
    }
  }

  return null;
}
