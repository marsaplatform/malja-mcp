import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_NAME, SERVER_VERSION } from './config.js';
import type { AppContext } from './context.js';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';

const INSTRUCTIONS = `Humanitarian MCP exposes trusted humanitarian open data through semantic tools. Depending on configuration it serves: UNHCR refugee statistics (displacement, demographics, asylum), World Bank context indicators (national population, GDP — the denominators behind normalize_by per-capita views), HDX/HAPI crisis data (ACLED conflict events, IPC food security, OCHA FTS funding) and ReliefWeb situation reports (narrative context).

Conventions:
- Call get_metadata first to learn which providers and datasets are actually enabled.
- Countries accept names or ISO3 codes, in English or Arabic; when unsure of spelling, call search_country first.
- role="asylum" means people hosted IN a country; role="origin" means people displaced FROM it.
- All data is read-only, sourced from official public APIs, and cached locally. Displacement figures are end-year stocks. Cite the year and the \`source\` field of each payload — different tools draw on different providers, so never attribute everything to one source.
- Start broad (get_metadata, country_profile) before drilling into specific datasets; use situation_reports to ground trends and anomalies in published reporting.`;

/**
 * Build the MCP server: every tool, resource and prompt registered against
 * the given context. Transport-agnostic — callers connect stdio, streamable
 * HTTP or in-memory transports.
 */
export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server, ctx);
  return server;
}
