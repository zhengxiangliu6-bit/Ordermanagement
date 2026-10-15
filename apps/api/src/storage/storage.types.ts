/**
 * Storage abstraction for controlled attachment content (architecture §2.1).
 * Business code depends on this interface only; replacing the driver must
 * not alter business logic.
 */
export interface StorageDriver {
  /** Stores content and returns the storage key it is addressable by. */
  put(key: string, data: Buffer): Promise<string>;
  /** Reads content; rejects when the key does not exist. */
  get(key: string): Promise<Buffer>;
  /** Deletes content; deleting a missing key resolves (idempotent). */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const STORAGE_DRIVER = 'STORAGE_DRIVER';
