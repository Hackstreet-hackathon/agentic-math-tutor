import { env } from "../env";

export interface ClassifyResult {
  isMathQuestion: boolean;
  confidence: "high" | "low";
}

/**
 * Uses gpt-4o-mini (OpenAI) or Groq Llama to determine whether a transcription is a
 * math / science question.  Falls back to optimistic "let it through" when
 * no API key is present.
 */
export async function classifyQuestion(
  text: string,
  signal?: AbortSignal,
): Promise<ClassifyResult> {
  const e = env();

  // Same provider as speech-to-text. No key or STT disabled → optimistic default so the user still gets answers.
  const openai = e.STT_PROVIDER === "openai";
  const apiKey = openai ? e.OPENAI_API_KEY : e.GROQ_API_KEY;
  if (!apiKey || e.STT_PROVIDER === "none") {
    return { isMathQuestion: true, confidence: "low" };
  }
  const url = openai ? `${e.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions` : "https://api.groq.com/openai/v1/chat/completions";
  const model = openai ? "gpt-4o-mini" : "llama-3.1-8b-instant";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
