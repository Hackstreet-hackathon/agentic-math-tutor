/** Minimal object-storage contract. Keys are opaque, server-generated paths (never user input). */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
  }
}
