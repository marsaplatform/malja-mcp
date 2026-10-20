import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createContext } from '../../src/context.js';

describe('createContext', () => {
  const dir = mkdtempSync(join(tmpdir(), 'malja-ctx-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('wires unhcr + worldbank with a memory cache by default', async () => {
    const ctx = await createContext(loadConfig({ MALJA_LOG_LEVEL: 'error' }));
    expect(ctx.registry.ids()).toEqual(['unhcr', 'worldbank']);
    expect(ctx.cache.backend).toBe('memory');
    // UNHCR stays primary: registration order follows MALJA_PROVIDERS order.
    expect(ctx.registry.primary().id).toBe('unhcr');
  });

  it('honours the sqlite cache backend when node:sqlite exists', async () => {
    const ctx = await createContext(
      loadConfig({
        MALJA_CACHE: 'sqlite',
        MALJA_CACHE_PATH: join(dir, 'ctx.sqlite'),
        MALJA_LOG_LEVEL: 'error',
      }),
    );
    // Node ≥ 22.5 → sqlite; older → documented fallback to memory.
    expect(['sqlite', 'memory']).toContain(ctx.cache.backend);
  });

  it('requires a pre-approved appname for the reliefweb provider, with guidance', async () => {
    await expect(
      createContext(loadConfig({ MALJA_PROVIDERS: 'reliefweb', MALJA_LOG_LEVEL: 'error' })),
    ).rejects.toThrow(/MALJA_RELIEFWEB_APPNAME/);

    const ctx = await createContext(
      loadConfig({
        MALJA_PROVIDERS: 'reliefweb',
        MALJA_RELIEFWEB_APPNAME: 'malja-test-abc123',
        MALJA_LOG_LEVEL: 'error',
      }),
    );
    expect(ctx.registry.ids()).toEqual(['reliefweb']);
  });

  it('requires an app identifier for the hdx provider, with guidance', async () => {
    await expect(
      createContext(loadConfig({ MALJA_PROVIDERS: 'hdx', MALJA_LOG_LEVEL: 'error' })),
    ).rejects.toThrow(/MALJA_HDX_APP_ID/);

    const ctx = await createContext(
      loadConfig({
        MALJA_PROVIDERS: 'hdx',
        MALJA_HDX_APP_ID: 'dGVzdDp0ZXN0QGV4YW1wbGUub3Jn',
        MALJA_LOG_LEVEL: 'error',
      }),
    );
    expect(ctx.registry.ids()).toEqual(['hdx']);
  });

  it('rejects unknown provider ids with the known list', async () => {
    await expect(
      createContext(loadConfig({ MALJA_PROVIDERS: 'nasa', MALJA_LOG_LEVEL: 'error' })),
    ).rejects.toThrow(/Unknown provider "nasa"/);
  });
});
