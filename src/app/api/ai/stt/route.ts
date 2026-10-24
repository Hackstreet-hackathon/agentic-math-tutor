import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { transcribeAudio } from "@/lib/server/ai/stt";

export const POST = route(async (req) => {
  await requireUser();
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) throw new HttpError(400, "No audio", "no_audio");
  if (file.size > 8_000_000) throw new HttpError(413, "That recording is too long.", "too_large");
  const result = await transcribeAudio(file);
  if (!result) return NextResponse.json({ error: { code: "stt_not_configured", message: "STT not configured" } }, { status: 503 });
  return NextResponse.json({ transcript: result.transcript });
});
