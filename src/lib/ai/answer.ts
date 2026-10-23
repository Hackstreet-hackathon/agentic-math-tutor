import { z } from "zod";

/**
 * The structured answer the tutor produces. Defined once, used by the server (validation of
 * model output) and the client (rendering). Every field the UI relies on has a default so
 * slightly-off model output degrades gracefully instead of failing.
 */
export const INTENTS = [
  "general",
  "explain",
  "solve",
  "check",
  "hint",
  "mistake",
  "simplify",
  "graph",
  "insert",
  "diagram",
  "summarize",
  "followup",
] as const;
export type Intent = (typeof INTENTS)[number];

export const answerSchema = z.object({
  intent: z.enum(INTENTS).catch("general"),
  /** Markdown-ish text; inline math in $...$, display math in $$...$$. */
  summary: z.string().max(6000).catch(""),
  steps: z
    .array(
      z.object({
        latex: z.string().max(2000).nullable().catch(null),
        explanation: z.string().max(2500).catch(""),
      }),
    )
    .max(40)
    .catch([]),
  finalAnswer: z.string().max(1500).nullable().catch(null),
  hint: z.string().max(2000).nullable().catch(null),
  mistake: z
    .object({
      stepIndex: z.number().int().nullable().catch(null),
      description: z.string().max(2000).catch(""),
      correction: z.string().max(2000).nullable().catch(null),
    })
    .nullable()
    .catch(null),
  graphExpressions: z.array(z.string().max(300)).max(6).catch([]),
  pageReferences: z
    .array(z.object({ page: z.number().int().min(1).catch(1), note: z.string().max(300).catch("") }))
    .max(8)
    .catch([]),
  followUps: z.array(z.string().max(200)).max(4).catch([]),
  confidence: z.enum(["low", "medium", "high"]).catch("medium"),
  needsClarification: z.string().max(600).nullable().catch(null),
});
export type Answer = z.infer<typeof answerSchema>;

/** Verification of the mathematics in an answer. Only `VERIFIED` may be shown as verified. */
export const verificationSchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "INCORRECT", "UNCERTAIN", "UNSUPPORTED"]),
  note: z.string().max(500).optional(),
});
export type Verification = z.infer<typeof verificationSchema>;

export interface StoredAnswer {
  answer: Answer;
  verification: Verification;
  /** True when the model did not return valid structured output and the raw text was used. */
  malformed?: boolean;
}

/**
 * Validate parsed model JSON. Returns null when there is nothing renderable (no summary, steps,
 * hint, mistake or clarification), so callers can fall back to the raw text.
 */
export function normalizeAnswer(raw: unknown): Answer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const hasContent = a.summary.trim() || a.steps.length > 0 || a.hint || a.mistake || a.needsClarification || a.finalAnswer;
  return hasContent ? a : null;
}

/** Fallback for non-JSON model output: show the text, flagged as unstructured. */
export function answerFromPlainText(text: string, intent: Intent): Answer {
  return answerSchema.parse({ intent, summary: text.trim().slice(0, 6000), steps: [], confidence: "low" });
}

/**
 * Strict JSON Schema for providers that support structured outputs. Every property is
 * required (nullable where optional) and additionalProperties is false, as OpenAI strict mode demands.
 */
export const ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "summary", "steps", "finalAnswer", "hint", "mistake", "graphExpressions", "pageReferences", "followUps", "confidence", "needsClarification"],
  properties: {
    intent: { type: "string", enum: [...INTENTS] },
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["latex", "explanation"],
        properties: { latex: { type: ["string", "null"] }, explanation: { type: "string" } },
      },
    },
    finalAnswer: { type: ["string", "null"] },
    hint: { type: ["string", "null"] },
    mistake: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["stepIndex", "description", "correction"],
      properties: {
        stepIndex: { type: ["integer", "null"] },
        description: { type: "string" },
        correction: { type: ["string", "null"] },
      },
    },
    graphExpressions: { type: "array", items: { type: "string" } },
    pageReferences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "note"],
        properties: { page: { type: "integer" }, note: { type: "string" } },
      },
    },
    followUps: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    needsClarification: { type: ["string", "null"] },
  },
} as const;
