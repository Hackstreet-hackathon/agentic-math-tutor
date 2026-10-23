import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: {} }));
vi.mock("./storage", () => ({ storage: () => ({}) }));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.DATABASE_URL = "postgresql://x";

const { sanitizeFilename } = await import("./documents");

describe("sanitizeFilename", () => {
  it("strips paths and control characters", () => {
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("C:\\Users\\me\\notes<1>.pdf")).toBe("notes1.pdf");
    expect(sanitizeFilename("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(sanitizeFilename("   ")).toBe("document.pdf");
    expect(sanitizeFilename("x".repeat(500) + ".pdf").length).toBeLessThanOrEqual(200);
  });
});
