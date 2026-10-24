import { z } from "zod";
import { chatRequestSchema } from "./request";

/** Where the Socratic exchange currently is; kept by the client and echoed on every turn. */
export const tutorStateSchema = z.object({
  /** What the student is working on, in a few words (set by the tutor). */
  goal: z.string().max(300).default(""),
  stage: z.enum(["idle", "hint", "check", "explain", "done"]).default("idle"),
  /** Wrong or unsure answers to the current check question. */
  attempts: z.number().int().min(0).max(10).default(0),
});
export type TutorState = z.infer<typeof tutorStateSchema>;
export const IDLE_STATE: TutorState = { goal: "", stage: "idle", attempts: 0 };

export const converseRequestSchema = chatRequestSchema
  .omit({ message: true, intent: true })
  .extend({
    /** What the student said (already transcribed). */
    transcript: z.string().trim().min(1).max(2000),
    tutorState: tutorStateSchema.nullish(),
  });
export type ConverseRequest = z.infer<typeof converseRequestSchema>;

export const triageSchema = z.object({
  kind: z.enum(["smalltalk", "math", "control"]).catch("math"),
  control: z.enum(["stop", "repeat", "stop_listening"]).nullable().catch(null),
  /** One short spoken line to say while the main model thinks (maths only). */
  ack: z.string().max(160).nullable().catch(null),
});
export type Triage = z.infer<typeof triageSchema>;

export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "control", "ack"],
  properties: {
    kind: { type: "string", enum: ["smalltalk", "math", "control"] },
    control: { type: ["string", "null"], enum: ["stop", "repeat", "stop_listening", null] },
    ack: { type: ["string", "null"] },
  },
} as const;

export type ConverseEvent =
  | { event: "meta"; data: { conversationId: string; kind: Triage["kind"]; model: string } }
  | { event: "control"; data: { control: NonNullable<Triage["control"]> } }
  /** A short filler to speak immediately while the real answer is being prepared. */
  | { event: "ack"; data: { text: string } }
  | { event: "sentence"; data: { text: string } }
  | { event: "state"; data: { tutorState: TutorState } }
  | { event: "done"; data: { messageId: string; text: string; latencyMs: number } }
  | { event: "error"; data: { code: string; message: string; retryAfterSec?: number } };

/** Phrases Whisper invents out of silence or room noise; never treat them as the student speaking. */
const PHANTOM = /^(thanks? for watching|thank you\.?|you|bye\.?|\.+|um+|uh+|hmm+|mm+)[.! ]*$/i;
export const isPhantomTranscript = (t: string) => t.trim().length < 2 || PHANTOM.test(t.trim());

/** Quick rules for control phrases so "stop" never waits on a model. */
export function quickControl(t: string): Triage["control"] {
  const s = t.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(stop listening|turn off (the )?(mic|microphone|listening)|end (the )?conversation)$/.test(s)) return "stop_listening";
  if (/^(stop|be quiet|quiet|shush|never ?mind|cancel|that's enough|enough)$/.test(s)) return "stop";
  if (/^(repeat( that| it)?|say (that|it) again|come again|what was that|pardon|sorry what)$/.test(s)) return "repeat";
  return null;
}

/** Follow-ups during an active teaching exchange stay on the main model without a triage call. */
export function isActiveExchange(state: TutorState | null | undefined): boolean {
  return Boolean(state && (state.stage === "hint" || state.stage === "check" || state.stage === "explain"));
}

const MATHY = /[0-9=+\-*/^√∫∑]|\b(equation|solve|solving|derivative|differentiate|integral|integrate|limit|matrix|matrices|determinant|inverse|factor|expand|simplify|rule|step|formula|theorem|fraction|algebra|calculus|graph|slope|angle|triangle|prime|root|square|exponent|logarithm|sin|cos|tan|quadratic|polynomial|sum|product|why|how)\b/i;
/** Cheap pre-check: with a circled selection, almost anything the student says is about it. */
export function looksMathy(t: string, hasSelection: boolean): boolean {
  return hasSelection ? /\b(this|that|these|here|it|step|rule|why|how|what|which|solve|mean)\b/i.test(t) || MATHY.test(t) : MATHY.test(t);
}
