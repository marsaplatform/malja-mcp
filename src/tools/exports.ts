import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SERVER_NAME, SERVER_VERSION } from '../config.js';
import type { AppContext } from '../context.js';
import type { DatasetId, NormalizedRecord } from '../providers/types.js';
import {
  CountryRoleSchema,
  DatasetIdSchema,
  yearFromInput,
  yearToInput,
} from '../schemas/common.js';
import { objectsToCsv } from '../viz/csv.js';
import { toGeoJson } from '../viz/geojson.js';
import { markdownTable } from '../viz/table.js';
import { buildCodebook, codebookMarkdown } from './codebook.js';
import {
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  resolveCountry,
  roleFilter,
} from './common.js';

/** Flatten a normalized record into a single-level object for CSV/tables. */
function flatten(record: NormalizedRecord): Record<string, unknown> {
  const { metrics, ...rest } = record;
  return { ...rest, ...metrics };
}

/**
 * Provenance every export carries: the exact tool call (a repeatable
 * extraction recipe for a paper's appendix), when it ran, which server
 * version served it and how to cite the source.
 */
export interface ExtractionManifest {
  tool: string;
  arguments: Record<string, unknown>;
  extracted_at: string;
  server: string;
  source: string;
  citation: string;
}

/** Manifest as CSV comment lines (readable via `comment='#'` in pandas / R). */
function manifestAsCsvHeader(manifest: ExtractionManifest): string {
  const lines = [
    '# humanitarian-mcp extraction manifest — re-run this exact call to reproduce',
    `# tool: ${manifest.tool}`,
    `# arguments: ${JSON.stringify(manifest.arguments)}`,
    `# extracted_at: ${manifest.extracted_at}`,
    `# server: ${manifest.server}`,
    `# source: ${manifest.source}`,
    `# citation: ${manifest.citation}`,
  ];
  return lines.join('\n') + '\n';
}

export function registerExportTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'export_data',
    {
      title: 'Export data',
      description:
        'Export normalized records from any dataset as csv, json, markdown or geojson (geojson only makes sense with group_by set, so rows map to countries). Use this when the user wants raw data to download or paste elsewhere.',
      inputSchema: {
        dataset: DatasetIdSchema.describe(
          'population | demographics | asylum-applications | asylum-decisions | context-indicators | idps | conflict-events | humanitarian-funding | food-security',
        ),
        format: z.enum(['csv', 'json', 'markdown', 'geojson']).describe('Serialization format'),
        country: z.string().optional().describe('Filter by country (name or ISO3)'),
        role: CountryRoleSchema.optional(),
        group_by: CountryRoleSchema.optional().describe(
          'Break rows down per asylum or origin country instead of aggregating',
        ),
        year_from: yearFromInput,
        year_to: yearToInput,
        limit: z.number().int().min(1).max(5000).optional().describe('Max rows (default 500)'),
        include_manifest: z
          .boolean()
          .optional()
          .describe(
            'Attach an extraction manifest (exact arguments, timestamp, server version, citation) for reproducibility. Default true.',
          ),
        include_codebook: z
          .boolean()
          .optional()
          .describe(
            "Attach a codebook documenting every exported variable (meaning, unit, derivation) — ready for a paper's data appendix. Default false.",
          ),
      },
      outputSchema: {
        dataset: z.string(),
        format: z.string(),
        row_count: z.number(),
        truncated: z.boolean(),
        /** The serialized payload: a string for csv/markdown, an object for json/geojson. */
        data: z.union([z.string(), z.record(z.unknown())]),
        manifest: z.record(z.unknown()).optional(),
        codebook: z
          .array(z.object({ field: z.string(), description: z.string(), unit: z.string() }))
          .optional(),
      },
    },
    async ({
      dataset,
      format,
      country,
      role,
      group_by,
      year_from,
      year_to,
      limit,
      include_manifest,
      include_codebook,
    }) => {
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const query: {
        dataset: DatasetId;
        yearFrom: number;
        yearTo: number;
        groupBy?: 'asylum' | 'origin';
        asylum_iso3?: string;
        origin_iso3?: string;
      } = { dataset: dataset as DatasetId, yearFrom, yearTo };

      if (country) {
        const ref = await resolveCountry(ctx, country);
        Object.assign(query, roleFilter(role ?? 'asylum', ref.iso3));
      }
      if (group_by) query.groupBy = group_by;

      const { records, truncated } = await fetchAllRows(ctx, query);
      const maxRows = limit ?? 500;
      const rows = records.slice(0, maxRows);
      const wasTruncated = truncated || records.length > maxRows;

      let manifest: ExtractionManifest | undefined;
      if (include_manifest ?? true) {
        const provenance = await datasetProvenance(ctx, dataset as DatasetId);
        manifest = {
          tool: 'export_data',
          arguments: {
            dataset,
            format,
            ...(country ? { country } : {}),
            ...(role ? { role } : {}),
            ...(group_by ? { group_by } : {}),
            year_from: yearFrom,
            year_to: yearTo,
            limit: maxRows,
          },
          extracted_at: new Date().toISOString(),
          server: `${SERVER_NAME}/${SERVER_VERSION}`,
          source: provenance.source,
          citation: provenance.citation,
        };
      }

      let data: string | Record<string, unknown>;
      let text: string;
      switch (format) {
        case 'csv': {
          const csv = objectsToCsv(rows.map(flatten));
          data = manifest ? manifestAsCsvHeader(manifest) + csv : csv;
          text = `CSV export — ${dataset}, ${rows.length} rows${manifest ? ' (manifest in `#` comment lines — read with `comment="#"`)' : ''}:\n\n\`\`\`csv\n${data}\`\`\``;
          break;
        }
        case 'json': {
          data = {
            dataset,
            rows: rows as unknown as Record<string, unknown>[],
            ...(manifest ? { manifest } : {}),
          };
          text = `JSON export — ${dataset}, ${rows.length} rows:\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
          break;
        }
        case 'markdown': {
          const flat = rows.map(flatten);
          const headers = flat.length > 0 ? Object.keys(flat[0]!) : [];
          data = markdownTable(
            headers,
            flat.map((row) => headers.map((h) => row[h] as string | number | null)),
          );
          text = data;
          if (manifest) {
            text += `\n\n> Extraction manifest: \`${JSON.stringify(manifest)}\``;
          }
          break;
        }
        case 'geojson': {
          const { featureCollection, skipped } = toGeoJson(rows);
          // `manifest` rides along as a GeoJSON foreign member (RFC 7946 §6.1).
          data = manifest ? { ...featureCollection, manifest } : featureCollection;
          text = `GeoJSON export — ${dataset}, ${(featureCollection['features'] as unknown[]).length} features${skipped.length > 0 ? ` (no centroid: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? '…' : ''})` : ''}:\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
          break;
        }
      }

      let codebook: ReturnType<typeof buildCodebook> | undefined;
      if (include_codebook) {
        const presentFields = [...new Set(rows.map(flatten).flatMap((row) => Object.keys(row)))];
        codebook = buildCodebook(dataset as DatasetId, presentFields);
        text += `\n\n## Codebook\n\n${codebookMarkdown(codebook)}`;
      }

      if (wasTruncated) {
        text += `\n\n_Note: output truncated to ${rows.length} rows. Narrow the year range or filter by country for a complete set._`;
      }

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          dataset,
          format,
          row_count: rows.length,
          truncated: wasTruncated,
          data,
          ...(manifest ? { manifest } : {}),
          ...(codebook ? { codebook } : {}),
        },
      };
    },
  );
}
