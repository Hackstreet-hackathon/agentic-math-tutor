import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/session";
import { synthesizeSpeech } from "@/lib/server/ai/tts";

export async function POST(req: NextRequest) {
  await requireUser();
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "No text" }, { status: 400 });
  const audioResponse = await synthesizeSpeech(text.slice(0, 4096));
  if (!audioResponse) return NextResponse.json({ error: "TTS not configured" }, { status: 503 });
  // Stream the audio back
  return new Response(audioResponse.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
