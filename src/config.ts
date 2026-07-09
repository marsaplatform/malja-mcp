/**
 * Runtime configuration, resolved once at startup from environment variables.
 * Every knob has a safe default so the server runs with zero configuration.
 */

export interface Config {
  /** Provider ids to enable, in priority order. */
  readonly providers: readonly string[];
  /** Cache backend. */
  readonly cacheBackend: 'memory' | 'sqlite';
  /** Path of the sqlite cache file (only used when cacheBackend === 'sqlite'). */
  readonly cachePath: string;
  /** Seconds an entry is considered fresh (served without any network call). */
  readonly cacheTtlSeconds: number;
  /** Seconds an entry may still be served stale while a background refresh runs. */
  readonly cacheStaleTtlSeconds: number;
  /** When true, never touch the network — serve from cache only. */
  readonly offline: boolean;
  /** Max outgoing requests per second, per provider. */
  readonly rateLimitRps: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Collect in-memory usage statistics (powers the demo dashboard). */
  readonly analytics: boolean;
  /** Port for --http mode. */
  readonly httpPort: number;
  /** Interface to bind in --http mode. Default localhost; set 0.0.0.0 to expose directly. */
  readonly httpHost: string;
  /** User-Agent sent with every outgoing request. */
  readonly userAgent: string;
  /** HDX HAPI app identifier (required only when the hdx provider is enabled). */
  readonly hdxAppIdentifier: string;
}

export const SERVER_NAME = 'humanitarian-mcp';
export const SERVER_VERSION = '0.5.1';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function intFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`Invalid ${key}: expected a non-negative integer, got "${raw}"`);
  }
  return value;
}

function boolFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** Build a {@link Config} from an environment (defaults to `process.env`). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const providersRaw = env['HMCP_PROVIDERS'] ?? 'unhcr,worldbank';
  const providers = providersRaw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (providers.length === 0) {
    throw new Error('HMCP_PROVIDERS must enable at least one provider');
  }

  const cacheBackend = (env['HMCP_CACHE'] ?? 'memory').toLowerCase();
  if (cacheBackend !== 'memory' && cacheBackend !== 'sqlite') {
    throw new Error(`Invalid HMCP_CACHE: expected "memory" or "sqlite", got "${cacheBackend}"`);
  }

  const logLevelRaw = (env['HMCP_LOG_LEVEL'] ?? 'info').toLowerCase();
  const logLevel = LOG_LEVELS.find((l) => l === logLevelRaw);
  if (!logLevel) {
    throw new Error(`Invalid HMCP_LOG_LEVEL: expected one of ${LOG_LEVELS.join(', ')}`);
  }

  return {
    providers,
    cacheBackend,
    cachePath: env['HMCP_CACHE_PATH'] ?? '.cache/humanitarian-mcp.sqlite',
    cacheTtlSeconds: intFromEnv(env, 'HMCP_CACHE_TTL', 3600),
    cacheStaleTtlSeconds: intFromEnv(env, 'HMCP_CACHE_STALE_TTL', 7 * 24 * 3600),
    offline: boolFromEnv(env, 'HMCP_OFFLINE', false),
    rateLimitRps: Math.max(1, intFromEnv(env, 'HMCP_RATE_LIMIT_RPS', 4)),
    logLevel,
    analytics: boolFromEnv(env, 'HMCP_ANALYTICS', true),
    httpPort: intFromEnv(env, 'HMCP_HTTP_PORT', 8642),
    httpHost: env['HMCP_HTTP_HOST']?.trim() || '127.0.0.1',
    userAgent:
      env['HMCP_USER_AGENT'] ??
      `${SERVER_NAME}/${SERVER_VERSION} (+https://github.com/ahmedvnabil/humanitarian-mcp)`,
    hdxAppIdentifier: env['HMCP_HDX_APP_ID']?.trim() ?? '',
  };
}
