import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalVolumeDriver } from './local-volume.driver';

describe('LocalVolumeDriver', () => {
  let root: string;
  let driver: LocalVolumeDriver;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'om-storage-'));
    driver = new LocalVolumeDriver(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips content by key', async () => {
    await driver.put('2026/09/a.bin', Buffer.from('hello'));
    expect(await driver.exists('2026/09/a.bin')).toBe(true);
    expect((await driver.get('2026/09/a.bin')).toString()).toBe('hello');
  });

  it('delete is idempotent and exists reflects it', async () => {
    await driver.put('b.bin', Buffer.from('x'));
    await driver.delete('b.bin');
    expect(await driver.exists('b.bin')).toBe(false);
    await expect(driver.delete('b.bin')).resolves.toBeUndefined();
  });

  it('get rejects missing keys', async () => {
    await expect(driver.get('missing.bin')).rejects.toThrow();
  });

  it('rejects traversal outside the volume root', async () => {
    await expect(driver.put('../escape.bin', Buffer.from('no'))).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(driver.get('../../etc/passwd')).rejects.toThrow(
      /Invalid storage key/,
    );
  });
});
