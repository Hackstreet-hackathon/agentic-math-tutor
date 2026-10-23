import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "./local";
import { StorageNotFoundError } from "./types";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mn-storage-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("LocalStorage", () => {
  it("round-trips, reports existence and deletes", async () => {
    const s = new LocalStorage(dir);
    await s.put("users/u1/documents/a.pdf", new Uint8Array([1, 2, 3]));
    expect(await s.exists("users/u1/documents/a.pdf")).toBe(true);
    expect(Array.from(await s.get("users/u1/documents/a.pdf"))).toEqual([1, 2, 3]);
    await s.delete("users/u1/documents/a.pdf");
    expect(await s.exists("users/u1/documents/a.pdf")).toBe(false);
    await expect(s.get("users/u1/documents/a.pdf")).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it("refuses keys that escape the storage root", async () => {
    const s = new LocalStorage(dir);
    await expect(s.put("../escape.txt", new Uint8Array([1]))).rejects.toThrow("Invalid storage key");
    await expect(s.get("/etc/passwd")).rejects.toThrow();
  });
});
