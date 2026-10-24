import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, { contentType: string; data: Buffer }>();
vi.mock("../db", () => ({
  db: {
    storedObject: {
      upsert: async ({ create, update }: { create: { key: string; contentType: string; data: Buffer }; update: { contentType: string; data: Buffer } }) => {
        rows.set(create.key, rows.has(create.key) ? update : { contentType: create.contentType, data: create.data });
      },
      findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { data: rows.get(where.key)!.data } : null),
      deleteMany: async ({ where }: { where: { key: string } }) => void rows.delete(where.key),
      count: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? 1 : 0),
    },
  },
}));
const { DbStorage } = await import("./db");
const { StorageNotFoundError } = await import("./types");

beforeEach(() => rows.clear());

describe("DbStorage", () => {
  it("round-trips, overwrites, reports existence and deletes", async () => {
    const s = new DbStorage();
    await s.put("users/u1/documents/a.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(await s.exists("users/u1/documents/a.pdf")).toBe(true);
    expect(Array.from(await s.get("users/u1/documents/a.pdf"))).toEqual([1, 2, 3]);
    await s.put("users/u1/documents/a.pdf", new Uint8Array([9]), "application/pdf");
    expect(Array.from(await s.get("users/u1/documents/a.pdf"))).toEqual([9]);
    await s.delete("users/u1/documents/a.pdf");
    expect(await s.exists("users/u1/documents/a.pdf")).toBe(false);
    await expect(s.get("users/u1/documents/a.pdf")).rejects.toBeInstanceOf(StorageNotFoundError);
  });
});
