import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "../session-token";

const SECRET = "test-secret-test-secret-test-secret-1234";

describe("session cookie signing", () => {
  it("round-trips a valid cookie", () => {
    expect(decodeSession(SECRET, encodeSession(SECRET, "user123"))).toBe("user123");
  });
  it("rejects tampered, unsigned, foreign-secret and empty cookies", () => {
    const good = encodeSession(SECRET, "user123");
    expect(decodeSession(SECRET, good.replace("user123", "user999"))).toBeNull();
    expect(decodeSession(SECRET, "user123")).toBeNull();
    expect(decodeSession(SECRET, "user123.")).toBeNull();
    expect(decodeSession(SECRET, undefined)).toBeNull();
    expect(decodeSession("another-secret-another-secret-123456", good)).toBeNull();
  });
  it("supports uuid user ids (which contain dashes) and legacy cuid ids", () => {
    for (const id of ["0b9d4c52-7a1e-4d63-9a2f-3a8f6c1d2e44", "cmvl4brl60002i67duzroj3gn"]) {
      expect(decodeSession(SECRET, encodeSession(SECRET, id))).toBe(id);
    }
  });
});
