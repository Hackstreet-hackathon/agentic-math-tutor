import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/session";
import { transcribeAudio } from "@/lib/server/ai/stt";

export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No audio" }, { status: 400 });
  const result = await transcribeAudio(file);
  if (!result) return NextResponse.json({ error: "STT not configured" }, { status: 503 });
  return NextResponse.json({ transcript: result.transcript });
}
