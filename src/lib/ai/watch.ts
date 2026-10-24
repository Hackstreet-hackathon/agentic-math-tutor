import { z } from "zod";
import { MAX_IMAGE_CHARS } from "./request";

/** Request from the live "Watch my work" tracker. Sent after the student pauses writing. */
export const watchRequestSchema = z.object({
  notebookId: z.string().min(1).max(64),
  pageId: z.string().min(1).max(64),
  /** The region holding the problem and the student's working, in page units. */
  bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(1), height: z.number().finite().min(1) }),
  /** Crop of the region (PDF + ink) for vision models; null when unavailable. */
  image: z
    .string()
    .max(MAX_IMAGE_CHARS)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Image must be a base64 PNG, JPEG or WebP data URL")
    .nullish(),
  /** Typed text / equations the student wrote, top to bottom. */
  typedLines: z.array(z.string().max(400)).max(40).default([]),
  /** Steps the student said are not mistakes; never flag these again. */
  ignoredSteps: z.array(z.string().max(400)).max(40).default([]),
});
export type WatchRequest = z.infer<typeof watchRequestSchema>;

export const watchModelSchema = z.object({
  problem: z.string().max(1500).nullable().catch(null),
  steps: z
    .array(
      z.object({
        latex: z.string().max(500).catch(""),
        status: z.enum(["ok", "wrong", "unclear"]).catch("unclear"),
        /** Vertical position of this line inside the supplied image/region, 0 (top) to 1 (bottom). */
        y: z.number().min(0).max(1).catch(0.5),
      }),
    )
    .max(40)
    .catch([]),
  firstWrongStep: z.number().int().nullable().catch(null),
  whatsWrong: z.string().max(600).nullable().catch(null),
  nudge: z.string().max(600).nullable().catch(null),
  voiceLine: z.string().max(200).nullable().catch(null),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
});
export type WatchModelResult = z.infer<typeof watchModelSchema>;

export const WATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["problem", "steps", "firstWrongStep", "whatsWrong", "nudge", "voiceLine", "confidence"],
  properties: {
    problem: { type: ["string", "null"] },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["latex", "status", "y"],
        properties: { latex: { type: "string" }, status: { type: "string", enum: ["ok", "wrong", "unclear"] }, y: { type: "number" } },
      },
    },
    firstWrongStep: { type: ["integer", "null"] },
    whatsWrong: { type: ["string", "null"] },
    nudge: { type: ["string", "null"] },
    voiceLine: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
} as const;

export type WatchStatus = "ok" | "flagged" | "unsure" | "empty";

export interface WatchFlag {
  stepIndex: number;
  latex: string;
  /** Page-unit y of the wrong line. */
  y: number;
  whatsWrong: string;
  nudge: string;
  voiceLine: string | null;
}

/** What the tracker returns to the client. */
export interface WatchResponse {
  status: WatchStatus;
  problem: string | null;
  stepCount: number;
  flag: WatchFlag | null;
  /** True when a deterministic SymPy check confirmed the verdict; otherwise the verdict is the AI's judgement. */
  verified: boolean;
}

/**
 * Turn raw model output into a response. Only a confident verdict on an actual step becomes a
 * flag: unclear reads and low-confidence judgements never accuse the student.
 */
export function toWatchResponse(raw: unknown, bounds: { y: number; height: number }, ignored: string[] = []): WatchResponse {
  const parsed = watchModelSchema.safeParse(raw);
  if (!parsed.success) return { status: "unsure", problem: null, stepCount: 0, flag: null, verified: false };
  const m = parsed.data;
  if (m.steps.length === 0) return { status: "empty", problem: m.problem, stepCount: 0, flag: null, verified: false };

  const idx = m.firstWrongStep;
  const step = idx !== null ? m.steps[idx] : undefined;
  const norm = (s: string) => s.replace(/\s+/g, "");
  const suppressed = step ? ignored.some((i) => norm(i) === norm(step.latex)) : false;
  if (!step || step.status !== "wrong" || suppressed || m.confidence === "low" || !m.nudge) {
    const anyUnclear = m.steps.some((s) => s.status === "unclear") || m.confidence === "low";
    return { status: m.steps.every((s) => s.status === "ok") ? "ok" : anyUnclear ? "unsure" : "ok", problem: m.problem, stepCount: m.steps.length, flag: null, verified: false };
  }
  return {
    status: "flagged",
    problem: m.problem,
    stepCount: m.steps.length,
    flag: {
      stepIndex: idx!,
      latex: step.latex,
      y: bounds.y + step.y * bounds.height,
      whatsWrong: m.whatsWrong ?? "",
      nudge: m.nudge,
      voiceLine: m.voiceLine,
    },
    verified: false,
  };
}
