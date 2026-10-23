import { z } from 'zod';
import { ALL_DATASETS } from '../providers/types.js';

/**
 * Zod fragments shared across tool input/output schemas so every tool speaks
 * the same shapes. These mirror the interfaces in src/providers/types.ts.
 */

export const DatasetIdSchema = z.enum(ALL_DATASETS as [string, ...string[]]);

export const CountryRoleSchema = z
  .enum(['asylum', 'origin'])
  .describe(
    '"asylum" = people hosted IN the country; "origin" = people displaced FROM the country',
  );

export const NormalizedRecordSchema = z.object({
  country: z.string(),
  country_code: z.string(),
  origin: z.string().optional(),
  origin_code: z.string().optional(),
  asylum: z.string().optional(),
  asylum_code: z.string().optional(),
  year: z.number(),
  population: z.number(),
  metrics: z.record(z.string(), z.number()),
  source: z.string(),
  last_updated: z.string(),
  dataset: z.string(),
});

export const PageInfoSchema = z.object({
  page: z.number(),
  maxPages: z.number().optional(),
  total: z.number().optional(),
});

export const CountryMatchSchema = z.object({
  name: z.string(),
  iso3: z.string(),
  iso2: z.string().optional(),
  region: z.string().optional(),
  subregion: z.string().optional(),
  score: z.number(),
});

export const YearValueSchema = z.object({ year: z.number(), value: z.number() });

/** Shared input fields. */
export const countryInput = z
  .string()
  .min(1)
  .describe('Country name or ISO3 code, e.g. "Egypt", "EGY", "syria"');

export const yearFromInput = z
  .number()
  .int()
  .min(1951)
  .max(2100)
  .optional()
  .describe('First year of the range (default: 10 years back)');

export const yearToInput = z
  .number()
  .int()
  .min(1951)
  .max(2100)
  .optional()
  .describe('Last year of the range (default: latest available)');
