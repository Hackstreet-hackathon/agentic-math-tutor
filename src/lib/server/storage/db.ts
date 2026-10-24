import { db } from "../db";
import { StorageNotFoundError, type ObjectStorage } from "./types";

/** Stores file bytes in Postgres: no separate object store needed (fine for a demo or small deployments). */
export class DbStorage implements ObjectStorage {
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const data = Buffer.from(body);
    await db.storedObject.upsert({ where: { key }, create: { key, contentType, data }, update: { contentType, data } });
  }

  async get(key: string): Promise<Uint8Array> {
    const row = await db.storedObject.findUnique({ where: { key }, select: { data: true } });
    if (!row) throw new StorageNotFoundError(key);
    return new Uint8Array(row.data);
  }

  async delete(key: string): Promise<void> {
    await db.storedObject.deleteMany({ where: { key } });
  }

  async exists(key: string): Promise<boolean> {
    return (await db.storedObject.count({ where: { key } })) > 0;
  }
}
