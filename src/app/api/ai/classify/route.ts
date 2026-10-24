import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/session";
import { classifyQuestion } from "@/lib/server/ai/classify";

export async function POST(req: NextRequest) {
  await requireUser();
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "No text" }, { status: 400 });
  const result = await classifyQuestion(text);
  return NextResponse.json(result);
}
