import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(resetRateLimits);

describe("rateLimit", () => {
  it("allows up to the limit within the window, then reports when to retry", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("u1", 3, 60_000, t0 + i * 1000).ok).toBe(true);
    const blocked = rateLimit("u1", 3, 60_000, t0 + 3000);
    expect(blocked).toMatchObject({ ok: false, remaining: 0 });
    expect(blocked.retryAfterSec).toBe(57);
  });
  it("slides: capacity returns as old hits leave the window", () => {
    const t0 = 5_000_000;
    rateLimit("u1", 1, 10_000, t0);
    expect(rateLimit("u1", 1, 10_000, t0 + 5_000).ok).toBe(false);
    expect(rateLimit("u1", 1, 10_000, t0 + 10_001).ok).toBe(true);
  });
  it("isolates users", () => {
    expect(rateLimit("a", 1, 60_000, 1).ok).toBe(true);
    expect(rateLimit("b", 1, 60_000, 1).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000, 2).ok).toBe(false);
  });
});
