import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/cache/memory.js';
import { createSqliteCache } from '../../src/cache/sqlite.js';
import { InstrumentedCache } from '../../src/cache/types.js';

describe('MemoryCache', () => {
  it('stores, retrieves, deletes and clears entries', async () => {
    const cache = new MemoryCache();
    await cache.set('a', { body: '1', fetchedAt: 10 });
    expect(await cache.get('a')).toEqual({ body: '1', fetchedAt: 10 });
    expect(await cache.size()).toBe(1);

    await cache.delete('a');
    expect(await cache.get('a')).toBeUndefined();

    await cache.set('b', { body: '2', fetchedAt: 20 });
    await cache.clear();
    expect(await cache.size()).toBe(0);
  });

  it('evicts the least recently used entry at capacity', async () => {
    const cache = new MemoryCache(2);
    await cache.set('a', { body: 'a', fetchedAt: 1 });
    await cache.set('b', { body: 'b', fetchedAt: 2 });
    await cache.get('a'); // refresh a → b is now oldest
    await cache.set('c', { body: 'c', fetchedAt: 3 });

    expect(await cache.get('a')).toBeDefined();
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('c')).toBeDefined();
  });
});

describe('SqliteCache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'malja-cache-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips entries through node:sqlite (skips when unavailable)', async () => {
    const cache = await createSqliteCache(join(dir, 'sub', 'cache.sqlite'));
    if (!cache) return; // Node without node:sqlite — memory fallback covers this.

    await cache.set('key', { body: '{"x":1}', etag: 'W/"abc"', fetchedAt: 123 });
    expect(await cache.get('key')).toEqual({ body: '{"x":1}', etag: 'W/"abc"', fetchedAt: 123 });

    // Upsert overwrites.
    await cache.set('key', { body: '{"x":2}', fetchedAt: 456 });
    const updated = await cache.get('key');
    expect(updated?.body).toBe('{"x":2}');
    expect(updated?.etag).toBeUndefined();

    expect(await cache.size()).toBe(1);
    await cache.delete('key');
    expect(await cache.size()).toBe(0);
  });
});

describe('InstrumentedCache', () => {
  it('counts hits and misses', async () => {
    const cache = new InstrumentedCache(new MemoryCache());
    await cache.get('missing');
    await cache.set('present', { body: 'x', fetchedAt: 1 });
    await cache.get('present');
    expect(cache.stats.misses).toBe(1);
    expect(cache.stats.hits).toBe(1);
  });
});
