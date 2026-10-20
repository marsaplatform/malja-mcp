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
  /** Max inbound requests per minute per client in --http mode (0 = unlimited). */
  readonly httpRateLimitRpm: number;
  /** User-Agent sent with every outgoing request. */
  readonly userAgent: string;
  /** HDX HAPI app identifier (required only when the hdx provider is enabled). */
  readonly hdxAppIdentifier: string;
  /** Pre-approved ReliefWeb API appname (required only when the reliefweb provider is enabled). */
  readonly reliefwebAppname: string;
  /** Default language of human-readable tool output (tools accept a per-call `locale`). */
  readonly locale: 'en' | 'ar';
  /** Digit shapes for Arabic output: Western "latn" (0-9, default) or Arabic-Indic "arab" (٠-٩). */
  readonly digits: 'latn' | 'arab';
}

export const SERVER_NAME = 'malja-mcp';
export const SERVER_VERSION = '0.6.0';

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

/** Current environment-variable prefix. */
export const ENV_PREFIX = 'MALJA_';
/** Prefix used before the Malja MCP rebrand (humanitarian-mcp); still honoured as a fallback. */
export const LEGACY_ENV_PREFIX = 'HMCP_';

/**
 * Return a copy of `env` where every legacy `HMCP_*` variable is mirrored to
 * its `MALJA_*` name unless the new name is already set. Lets existing
 * deployments keep working after the rename. Deprecated — will be removed in a
 * future major release.
 */
export function withLegacyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX) || value === undefined) continue;
    const modern = ENV_PREFIX + key.slice(LEGACY_ENV_PREFIX.length);
    if (out[modern] === undefined) out[modern] = value;
  }
  return out;
}

/** Build a {@link Config} from an environment (defaults to `process.env`). */
export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): Config {
  const env = withLegacyEnv(rawEnv);
  const providersRaw = env['MALJA_PROVIDERS'] ?? 'unhcr,worldbank';
  const providers = providersRaw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (providers.length === 0) {
    throw new Error('MALJA_PROVIDERS must enable at least one provider');
  }

  const cacheBackend = (env['MALJA_CACHE'] ?? 'memory').toLowerCase();
  if (cacheBackend !== 'memory' && cacheBackend !== 'sqlite') {
    throw new Error(`Invalid MALJA_CACHE: expected "memory" or "sqlite", got "${cacheBackend}"`);
  }

  const logLevelRaw = (env['MALJA_LOG_LEVEL'] ?? 'info').toLowerCase();
  const logLevel = LOG_LEVELS.find((l) => l === logLevelRaw);
  if (!logLevel) {
    throw new Error(`Invalid MALJA_LOG_LEVEL: expected one of ${LOG_LEVELS.join(', ')}`);
  }

  const localeRaw = (env['MALJA_LOCALE'] ?? 'en').trim().toLowerCase() || 'en';
  if (localeRaw !== 'en' && localeRaw !== 'ar') {
    throw new Error(`Invalid MALJA_LOCALE: expected "en" or "ar", got "${localeRaw}"`);
  }
  const digitsRaw = (env['MALJA_DIGITS'] ?? 'latn').trim().toLowerCase() || 'latn';
  if (digitsRaw !== 'latn' && digitsRaw !== 'arab') {
    throw new Error(`Invalid MALJA_DIGITS: expected "latn" or "arab", got "${digitsRaw}"`);
  }

  return {
    providers,
    cacheBackend,
    cachePath: env['MALJA_CACHE_PATH'] ?? '.cache/malja-mcp.sqlite',
    cacheTtlSeconds: intFromEnv(env, 'MALJA_CACHE_TTL', 3600),
    cacheStaleTtlSeconds: intFromEnv(env, 'MALJA_CACHE_STALE_TTL', 7 * 24 * 3600),
    offline: boolFromEnv(env, 'MALJA_OFFLINE', false),
    rateLimitRps: Math.max(1, intFromEnv(env, 'MALJA_RATE_LIMIT_RPS', 4)),
    logLevel,
    analytics: boolFromEnv(env, 'MALJA_ANALYTICS', true),
    httpPort: intFromEnv(env, 'MALJA_HTTP_PORT', 8642),
    httpHost: env['MALJA_HTTP_HOST']?.trim() || '127.0.0.1',
    httpRateLimitRpm: intFromEnv(env, 'MALJA_HTTP_RATE_LIMIT_RPM', 120),
    userAgent:
      env['MALJA_USER_AGENT'] ??
      `${SERVER_NAME}/${SERVER_VERSION} (+https://github.com/marsaplatform/malja-mcp)`,
    hdxAppIdentifier: env['MALJA_HDX_APP_ID']?.trim() ?? '',
    reliefwebAppname: env['MALJA_RELIEFWEB_APPNAME']?.trim() ?? '',
    locale: localeRaw,
    digits: digitsRaw,
  };
}
