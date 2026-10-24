import { env } from "../env";

export interface ClassifyResult {
  isMathQuestion: boolean;
  confidence: "high" | "low";
}

/**
 * Uses Groq Llama (free tier) to determine whether a transcription is a
 * math / science question.  Falls back to optimistic "let it through" when
 * no API key is present.
 */
export async function classifyQuestion(
  text: string,
  signal?: AbortSignal,
): Promise<ClassifyResult> {
  const e = env();

  // No key or STT disabled → optimistic default so the user still gets answers
  if (!e.GROQ_API_KEY || e.STT_PROVIDER === "none") {
    return { isMathQuestion: true, confidence: "low" };
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${e.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "You are a classifier. Reply with only YES or NO.",
          },
          {
            role: "user",
            content: `Is the following a math, physics, or science question that a student might ask?\n\n"${text}"`,
          },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
      signal,
    });

    if (!res.ok) return { isMathQuestion: true, confidence: "low" };

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";

    if (answer.startsWith("YES")) return { isMathQuestion: true, confidence: "high" };
    if (answer.startsWith("NO")) return { isMathQuestion: false, confidence: "high" };

    // Unclear response — let it through
    return { isMathQuestion: true, confidence: "low" };
  } catch {
    return { isMathQuestion: true, confidence: "low" };
  }
}
