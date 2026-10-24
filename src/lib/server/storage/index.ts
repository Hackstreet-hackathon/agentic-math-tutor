import { env } from "../env";
import { DbStorage } from "./db";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { ObjectStorage } from "./types";

export type { ObjectStorage } from "./types";
export { StorageNotFoundError } from "./types";

let instance: ObjectStorage | undefined;

/** Storage backend selected by `STORAGE_PROVIDER`. */
export function storage(): ObjectStorage {
  if (instance) return instance;
  const e = env();
  if (e.STORAGE_PROVIDER === "s3") {
    if (!e.OBJECT_STORAGE_BUCKET || !e.OBJECT_STORAGE_ACCESS_KEY || !e.OBJECT_STORAGE_SECRET_KEY) {
      throw new Error("STORAGE_PROVIDER=s3 requires OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY");
    }
    instance = new S3Storage({
      endpoint: e.OBJECT_STORAGE_ENDPOINT,
      region: e.OBJECT_STORAGE_REGION,
      bucket: e.OBJECT_STORAGE_BUCKET,
      accessKeyId: e.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: e.OBJECT_STORAGE_SECRET_KEY,
    });
  } else if (e.STORAGE_PROVIDER === "db") {
    instance = new DbStorage();
  } else {
    instance = new LocalStorage(e.LOCAL_STORAGE_DIR);
  }
  return instance;
}
