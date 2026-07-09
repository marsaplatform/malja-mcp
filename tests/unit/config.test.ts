import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies sensible defaults with an empty environment', () => {
    const config = loadConfig({});
    expect(config.providers).toEqual(['unhcr', 'worldbank']);
    expect(config.cacheBackend).toBe('memory');
    expect(config.cacheTtlSeconds).toBe(3600);
    expect(config.offline).toBe(false);
    expect(config.rateLimitRps).toBe(4);
    expect(config.logLevel).toBe('info');
    expect(config.analytics).toBe(true);
    expect(config.userAgent).toContain('humanitarian-mcp/');
  });

  it('parses provider lists, booleans and integers', () => {
    const config = loadConfig({
      HMCP_PROVIDERS: 'unhcr, reliefweb ',
      HMCP_OFFLINE: '1',
      HMCP_ANALYTICS: 'false',
      HMCP_CACHE_TTL: '60',
      HMCP_CACHE: 'sqlite',
    });
    expect(config.providers).toEqual(['unhcr', 'reliefweb']);
    expect(config.offline).toBe(true);
    expect(config.analytics).toBe(false);
    expect(config.cacheTtlSeconds).toBe(60);
    expect(config.cacheBackend).toBe('sqlite');
  });

  it('rejects invalid values with clear messages', () => {
    expect(() => loadConfig({ HMCP_CACHE: 'redis' })).toThrow(/HMCP_CACHE/);
    expect(() => loadConfig({ HMCP_LOG_LEVEL: 'loud' })).toThrow(/HMCP_LOG_LEVEL/);
    expect(() => loadConfig({ HMCP_CACHE_TTL: '-5' })).toThrow(/HMCP_CACHE_TTL/);
    expect(() => loadConfig({ HMCP_PROVIDERS: ' , ' })).toThrow(/at least one provider/);
  });

  it('clamps the rate limit to at least 1 rps', () => {
    expect(loadConfig({ HMCP_RATE_LIMIT_RPS: '0' }).rateLimitRps).toBe(1);
  });
});
