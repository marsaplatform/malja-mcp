#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, SERVER_VERSION, loadConfig } from './config.js';
import { createContext } from './context.js';
import { startHttpServer } from './http/server.js';
import { createServer } from './server.js';

/**
 * Entry point.
 *
 *   malja-mcp              stdio transport (Claude Desktop, Cursor, ...)
 *   malja-mcp --http       streamable HTTP endpoint + demo dashboard
 *   malja-mcp --version    print version and exit
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const ctx = await createContext(config);

  if (args.includes('--http')) {
    const portFlag = args.indexOf('--port');
    const port =
      portFlag !== -1 && args[portFlag + 1] ? Number(args[portFlag + 1]) : config.httpPort;
    await startHttpServer(ctx, port);
    return;
  }

  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  ctx.logger.info(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`, {
    providers: ctx.registry.ids(),
    cache: ctx.cache.backend,
    offline: config.offline,
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
