import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';

/**
 * Built-in prompt templates. Each one steers the model toward the right tool
 * sequence and an output format suited to humanitarian reporting, so clients
 * (Claude Desktop, Cursor, ...) can offer one-click workflows.
 *
 * Attribution rule baked into every prompt: figures come from more than one
 * provider (UNHCR, World Bank, HDX, ReliefWeb, ...), so cite the `source`
 * each tool reports per payload — never blanket-credit a single agency.
 * Crisis tools (conflict_events, food_security, humanitarian_funding,
 * situation_reports) depend on which providers are enabled; if one is
 * unavailable, say so briefly and continue rather than failing the task.
 */
export function registerPrompts(server: McpServer, _ctx: AppContext): void {
  const country = z.string().describe('Country name or ISO3 code');

  server.registerPrompt(
    'summarize_situation',
    {
      title: 'Summarize humanitarian situation',
      description: 'Concise overview of displacement in and from a country',
      argsSchema: { country },
    },
    ({ country: c }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Summarize the current humanitarian displacement situation for ${c}.`,
              '',
              'Steps: call country_profile first; add trend_analysis for the refugee metric; check demographics. If crisis data is enabled, add one line of context from conflict_events or food_security.',
              'Deliver: a 3-paragraph summary — (1) who the country hosts, (2) who has fled it, (3) the trend and what changed most recently. Cite figures with their year and the source each tool reports (e.g. UNHCR for displacement, HDX for conflict).',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'compare_two_countries',
    {
      title: 'Compare two countries',
      description: 'Side-by-side displacement comparison of two countries',
      argsSchema: {
        country_a: z.string().describe('First country'),
        country_b: z.string().describe('Second country'),
      },
    },
    ({ country_a, country_b }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Compare the humanitarian situations of ${country_a} and ${country_b}.`,
              '',
              'Use compare_countries for refugees and asylum_seekers over the last 10 years, then latest_statistics for each. Run compare_countries again with normalize_by="population" — absolute numbers and per-1,000-residents numbers often tell different stories.',
              'Deliver: a comparison table (absolute and per-capita), then 3 bullet insights on how their roles differ (host vs origin, scale, trajectory). Cite each figure with its year and reported source.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'donor_briefing',
    {
      title: 'Generate donor briefing',
      description: 'Funding-oriented briefing for a country situation',
      argsSchema: {
        country,
        audience: z
          .string()
          .optional()
          .describe('e.g. "institutional donors", "private foundations"'),
      },
    },
    ({ country: c, audience }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Prepare a donor briefing on the displacement situation in ${c}${audience ? ` for ${audience}` : ''}.`,
              '',
              'Use generate_country_report as the base, then demographics to highlight women and children shares. If crisis data is enabled, add humanitarian_funding (appeal coverage is the core donor metric) and food_security for severity.',
              'Deliver: one page — headline figures, appeal requirements vs funding received with coverage %, 3 trends that matter for funding decisions, demographic vulnerabilities, and a data-quality note. Formal tone; cite every figure with its year and the source its tool reports (UNHCR, OCHA FTS via HDX, IPC via HDX, ...).',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'explain_trends',
    {
      title: 'Explain refugee trends',
      description: 'Plain-language explanation of how and why displacement changed',
      argsSchema: { country },
    },
    ({ country: c }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Explain the refugee trends for ${c} to a non-specialist.`,
              '',
              'Use trend_analysis (both role="asylum" and role="origin"), then generate_chart (format="mermaid") to illustrate. For the years where the trend breaks, call situation_reports to see what was actually reported at the time and anchor the explanation in it.',
              'Deliver: plain-language narrative — what direction, how fast, which years broke the pattern and what the reporting says happened — with the chart embedded. Distinguish clearly between people hosted IN the country and people FROM it, and cite each source as reported.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'find_anomalies',
    {
      title: 'Find anomalies',
      description: 'Hunt for statistically unusual years in a country’s displacement data',
      argsSchema: { country },
    },
    ({ country: c }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Find anomalies in the displacement data for ${c}.`,
              '',
              'Run trend_analysis for refugees, asylum_seekers and idps on both roles over the last 20 years (year_from set accordingly). Collect every anomalous year reported. Then, for each anomalous year, call conflict_events and situation_reports (year_from = year_to = that year) to look for corroboration in recorded violence and published reporting.',
              'Deliver: a table of anomalies (year, metric, direction, z-score) and, for each, an explanation — grounded in the reports and conflict data when they corroborate it, and clearly labelled as hypothesis when they do not.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'executive_report',
    {
      title: 'Generate executive report',
      description: 'Boardroom-ready report on a country situation',
      argsSchema: { country },
    },
    ({ country: c }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Produce an executive report on the humanitarian situation in ${c}.`,
              '',
              'Base it on generate_country_report; add top_host_countries to position the country globally (once absolute, once with normalize_by="population"). If crisis data is enabled, add a short crisis-context paragraph from conflict_events and food_security.',
              'Deliver: executive summary (5 sentences max), key figures table, trend chart (mermaid), regional context, and a "what to watch" section. No jargon; spell out acronyms once; cite each figure with its year and reported source.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'infographic_summary',
    {
      title: 'Create infographic summary',
      description: 'Numbers and chart specs ready to hand to a designer',
      argsSchema: { country },
    },
    ({ country: c }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Prepare the content for a one-page infographic about displacement in ${c}.`,
              '',
              'Use country_profile and demographics for headline numbers; generate_chart (format="svg") for the trend visual; generate_map for a geographic element if relevant.',
              'Deliver: 5 headline stats (big number + 6-word caption each), the SVG chart, a suggested color-coded severity indicator, and one attribution line per source actually used (e.g. "Sources: UNHCR 2024; World Bank 2023").',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'crisis_overview',
    {
      title: 'Crisis overview',
      description: 'Integrated displacement + conflict + hunger + funding picture for a country',
      argsSchema: { country },
    },
    ({ country: c }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Build an integrated crisis overview for ${c}.`,
              '',
              'Call country_profile for displacement; conflict_events for violence; food_security for hunger severity; humanitarian_funding for appeal coverage; situation_reports for the latest published reporting. Skip gracefully whatever the enabled providers do not serve, and note the gap in one line.',
              'Deliver: a situation-report-style brief — headline (2 sentences), displacement, conflict, food security, funding coverage, and "latest reporting" with linked report titles. One line per section max where data is thin. Cite each section with the source its tool reports; never attribute everything to one agency.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
