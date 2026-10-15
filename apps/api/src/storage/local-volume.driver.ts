import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageDriver } from './storage.types.js';

/**
 * Filesystem driver storing attachment content on a persistent server
 * volume. Keys resolve inside the volume root only; any key that would
 * escape the root (traversal, absolute paths) is rejected.
 */
export class LocalVolumeDriver implements StorageDriver {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async put(key: string, data: Buffer): Promise<string> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  private resolveKey(key: string): string {
    if (!key.trim()) {
      throw new Error('Storage key must not be empty.');
    }
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path;
  }
}
