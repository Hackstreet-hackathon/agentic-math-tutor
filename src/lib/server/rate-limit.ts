/**
 * Sliding-window rate limiter. In-memory and per-process: good for a single instance and for
 * development; put the same interface in front of Redis (or similar) when running several.
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): RateLimitResult {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k);
  return { ok: true, remaining: limit - recent.length, retryAfterSec: 0 };
}

export function resetRateLimits() {
  hits.clear();
}
