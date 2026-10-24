import { HttpError } from "../http";
import { env } from "../env";

export interface STTResult {
  transcript: string;
}

interface VerboseSegment {
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
}

/**
 * Whisper "hears" text in silence and room noise ("Thank you.", repeated phrases). Its segments say how
 * likely that is; drop a result when every segment looks like non-speech.
 */
export function looksLikeNoSpeech(segments: VerboseSegment[] | undefined): boolean {
  if (!segments || segments.length === 0) return false;
  return segments.every((s) => (s.no_speech_prob ?? 0) > 0.6 || ((s.avg_logprob ?? 0) < -1.2 && (s.no_speech_prob ?? 0) > 0.3) || (s.compression_ratio ?? 0) > 2.6);
}

/**
 * Returns null when speech-to-text is switched off server-side. A provider that is configured but fails
 * throws a 502, so the client can tell "not set up" from "try again".
 */
export async function transcribeAudio(audioBlob: Blob, signal?: AbortSignal): Promise<STTResult | null> {
  const e = env();
  if (e.STT_PROVIDER !== "openai") return null;

  const model = e.OPENAI_STT_MODEL ?? "whisper-1";
  const verbose = model.startsWith("whisper");
  const form = new FormData();
  form.append("file", audioBlob, (audioBlob as File).name || "audio.webm");
  form.append("model", model);
  form.append("response_format", verbose ? "verbose_json" : "json");
  form.append("language", e.OPENAI_STT_LANGUAGE ?? "en");
  // A hint about the vocabulary; it also nudges Whisper away from inventing chatter.
  form.append("prompt", "A student talking about maths: equations, derivatives, integrals, matrices, factoring.");

  let res: Response;
  try {
    res = await fetch(`${e.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.OPENAI_API_KEY ?? ""}` },
      body: form,
      signal: signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(502, "Speech recognition could not be reached.", "stt_unreachable");
  }
  if (!res.ok) throw new HttpError(502, `Speech recognition failed (${res.status}).`, "stt_failed");

  const json = (await res.json()) as { text?: string; segments?: VerboseSegment[] };
  if (looksLikeNoSpeech(json.segments)) return { transcript: "" };
  return { transcript: (json.text ?? "").trim() };
}
