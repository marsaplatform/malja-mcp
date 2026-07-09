import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../context.js';
import { registerAnalyticsTools } from './analytics.js';
import { registerAsylumTools } from './asylum.js';
import { registerChartTools } from './charts.js';
import { registerCountryTools } from './countries.js';
import { registerCrisisTools } from './crisis.js';
import { registerExportTools } from './exports.js';
import { registerMetaTools } from './meta.js';
import { registerPopulationTools } from './population.js';
import { registerReportTools } from './reports.js';

/** Register every tool. Order defines the order clients list them in. */
export function registerTools(server: McpServer, ctx: AppContext): void {
  registerCountryTools(server, ctx);
  registerPopulationTools(server, ctx);
  registerAsylumTools(server, ctx);
  registerCrisisTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerChartTools(server, ctx);
  registerReportTools(server, ctx);
  registerExportTools(server, ctx);
  registerMetaTools(server, ctx);
}
