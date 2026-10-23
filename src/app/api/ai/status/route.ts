import { aiStatus } from "@/lib/server/ai/factory";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** Whether the AI tutor is available. Never includes keys, base URLs or other secrets. */
export const GET = route(async () => {
  await requireUser();
  const s = aiStatus();
  // The operator-facing reason (which env var is missing) is only shown outside production.
  return json({ ...s, reason: process.env.NODE_ENV === "production" ? undefined : s.reason });
});
