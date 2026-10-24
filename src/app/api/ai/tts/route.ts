import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { synthesizeSpeech } from "@/lib/server/ai/tts";

export const POST = route(async (req) => {
  await requireUser();
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) throw new HttpError(400, "No text", "no_text");
  const audioResponse = await synthesizeSpeech(text.slice(0, 4096));
  // 503 only means "not set up"; a provider failure is a 502 (thrown above) so the client can retry.
  if (!audioResponse) return NextResponse.json({ error: { code: "tts_not_configured", message: "TTS not configured" } }, { status: 503 });
  return new Response(audioResponse.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
