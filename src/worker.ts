/**
 * Malja MCP on Cloudflare Workers.
 *
 * Stateless Streamable HTTP (JSON responses) at `/mcp`: every request builds a
 * fresh McpServer over a context that is created once per isolate, so the
 * in-memory cache is shared across requests. All 24 tools, resources and
 * prompts are the same implementations used by the stdio / --http modes.
 *
 * Worker-specific behaviour:
 *   - cache: memory only (node:sqlite is not available on Workers);
 *   - export_report: PDF is off (no headless browser), HTML is returned —
 *     pass `inline: true` to get the document in the response, because the
 *     export:// store lives in one isolate and is not shared between requests;
 *   - API identifiers (MALJA_HDX_APP_ID, MALJA_RELIEFWEB_APPNAME) come from
 *     Worker secrets/vars, never from the repository.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { SERVER_NAME, SERVER_VERSION, loadConfig } from './config.js';
import { createContext } from './context.js';
import type { AppContext } from './context.js';
import { createServer } from './server.js';

/** Worker bindings: any MALJA_* / HMCP_* string var or secret. */
export type WorkerEnv = Record<string, unknown>;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers':
    'content-type,accept,authorization,mcp-protocol-version,mcp-session-id,last-event-id',
  'access-control-expose-headers': 'mcp-session-id,mcp-protocol-version',
};

/** Defaults that differ from the Node server because of the Workers runtime. */
const WORKER_DEFAULTS: Record<string, string> = {
  MALJA_CACHE: 'memory',
  MALJA_PDF: 'off',
  MALJA_LOG_LEVEL: 'warn',
};

/** Turn Worker bindings into the env shape `loadConfig` expects (strings only). */
export function workerProcessEnv(env: WorkerEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...WORKER_DEFAULTS };
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string' && (key.startsWith('MALJA_') || key.startsWith('HMCP_'))) {
      out[key] = value;
    }
  }
  // Never try a local browser or sqlite file on Workers.
  out['MALJA_PDF'] = 'off';
  out['MALJA_CACHE'] = 'memory';
  return out;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...CORS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function info(url: URL, ctx?: AppContext): Record<string, unknown> {
  return {
    name: SERVER_NAME,
    title: 'Malja MCP — ملجأ',
    version: SERVER_VERSION,
    runtime: 'cloudflare-workers',
    transport: 'streamable-http (stateless, JSON responses)',
    endpoint: `${url.origin}/mcp`,
    providers: ctx?.registry.ids() ?? [],
    docs: 'https://github.com/marsaplatform/malja-mcp#readme',
    website: 'https://spaces.marsaplatform.com/s/k3sb9ww3dj/',
    usage: 'POST JSON-RPC to /mcp with `accept: application/json, text/event-stream`.',
  };
}

let cached: { key: string; ctx: Promise<AppContext> } | undefined;

/** One AppContext per isolate (and per configuration). */
export function contextFor(env: WorkerEnv): Promise<AppContext> {
  const processEnv = workerProcessEnv(env);
  const key = JSON.stringify(Object.entries(processEnv).sort());
  if (!cached || cached.key !== key) {
    const ctx = createContext(loadConfig(processEnv));
    cached = { key, ctx };
    ctx.catch(() => {
      if (cached?.ctx === ctx) cached = undefined;
    });
  }
  return cached.ctx;
}

export interface HandlerOptions {
  /** Inject a ready context (tests); defaults to one built from `env`. */
  context?: AppContext;
  /** Redirect target for GET / (the Malja page). */
  homeUrl?: string;
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  options: HandlerOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (path === '/mcp/health' || path === '/health') {
    const ctx = options.context ?? (await contextFor(env));
    return json({
      ok: true,
      service: SERVER_NAME,
      version: SERVER_VERSION,
      runtime: 'cloudflare-workers',
      providers: ctx.registry.ids(),
    });
  }

  if (path === '/mcp') {
    const accept = request.headers.get('accept') ?? '';
    if (request.method === 'GET' && !accept.includes('text/event-stream')) {
      return json(info(url, options.context ?? (await contextFor(env))));
    }
    if (request.method !== 'POST') {
      return json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed: this endpoint is stateless; send POST requests.',
          },
          id: null,
        },
        405,
      );
    }
    const ctx = options.context ?? (await contextFor(env));
    const server = createServer(ctx, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }

  if (path === '/') {
    const home =
      options.homeUrl ?? (typeof env['MALJA_HOME_URL'] === 'string' ? env['MALJA_HOME_URL'] : '');
    if (home && request.method === 'GET') return Response.redirect(home, 302);
    return json(info(url, options.context ?? (await contextFor(env))));
  }

  return json({ error: 'not_found', hint: 'MCP endpoint: POST /mcp' }, 404);
}

export default {
  fetch: (request: Request, env: WorkerEnv): Promise<Response> => handleRequest(request, env),
};
