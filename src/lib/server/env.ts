import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage-data"),
  OBJECT_STORAGE_ENDPOINT: optionalString,
  OBJECT_STORAGE_REGION: z.string().default("auto"),
  OBJECT_STORAGE_BUCKET: optionalString,
  OBJECT_STORAGE_ACCESS_KEY: optionalString,
  OBJECT_STORAGE_SECRET_KEY: optionalString,

  LLM_PROVIDER: z.enum(["openai", "groq", "none"]).default("none"),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_BASE_URL: optionalString,
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,
  /** Per-request upstream timeout for LLM calls. */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(200).max(16_000).default(1_800),
  /** Capability overrides for models the built-in table does not know ("true" / "false"). */
  LLM_SUPPORTS_VISION: optionalString,
  LLM_SUPPORTS_JSON_SCHEMA: optionalString,
  LLM_SUPPORTS_JSON_OBJECT: optionalString,
  LLM_SUPPORTS_STREAMING: optionalString,
  /** Requests per user per minute on expensive AI endpoints. */
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(20),

  STT_PROVIDER: z.enum(["openai", "groq", "gradium", "none"]).default("none"),
  TTS_PROVIDER: z.enum(["openai", "gradium", "none"]).default("none"),
  OPENAI_TTS_MODEL: optionalString,
  OPENAI_TTS_VOICE: optionalString,
  GRADIUM_API_KEY: optionalString,

  /** Fast model for voice-conversation triage and small talk (free options: groq, gemini). */
  FAST_LLM_PROVIDER: z.enum(["openai", "groq", "gemini", "none"]).default("openai"),
  FAST_LLM_MODEL: optionalString,
  GEMINI_API_KEY: optionalString,
  /** Laya (ConvAI) System One classifier key; reserved for the voice triage step. */
  LAYA_API_KEY: optionalString,
  /** Speaking style for gpt-4o-mini-tts, e.g. "warm, encouraging teacher". */
  OPENAI_TTS_STYLE: optionalString,

  MATH_SERVICE_URL: optionalString,

  MAX_PDF_MB: z.coerce.number().positive().default(50),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Validated server-only environment. Throws a readable error when misconfigured. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
