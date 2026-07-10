/**
 * Provider abstraction.
 *
 * Every data source (UNHCR, ReliefWeb, HDX, ...) lives in its own module under
 * `src/providers/<id>/` and implements {@link HumanitarianProvider}. Nothing
 * provider-specific may leak outside that module: tools, resources and prompts
 * only ever see normalized records and this interface.
 */

/** Datasets known to the platform. Providers declare which ones they serve. */
export type DatasetId =
  | 'population'
  | 'demographics'
  | 'asylum-applications'
  | 'asylum-decisions'
  | 'context-indicators'
  | 'idps'
  | 'conflict-events'
  | 'humanitarian-funding'
  | 'food-security'
  | 'situation-reports';

export const ALL_DATASETS: readonly DatasetId[] = [
  'population',
  'demographics',
  'asylum-applications',
  'asylum-decisions',
  'context-indicators',
  'idps',
  'conflict-events',
  'humanitarian-funding',
  'food-security',
  'situation-reports',
];

/**
 * The normalized record every provider must emit.
 *
 * Consistent field names across providers are the core promise of this MCP:
 * `country`, `country_code`, `year`, `population`, `source`, `last_updated`,
 * `dataset` are always present; dataset-specific figures live in `metrics`.
 */
export interface NormalizedRecord {
  /** Display name of the country this record is about. */
  country: string;
  /** ISO 3166-1 alpha-3 code (empty string when the source aggregates, e.g. "various"). */
  country_code: string;
  /** Country of origin, when the dataset distinguishes origin vs asylum. */
  origin?: string;
  origin_code?: string;
  /** Country of asylum, when the dataset distinguishes origin vs asylum. */
  asylum?: string;
  asylum_code?: string;
  year: number;
  /** Headline figure for the record (total people, applications, decisions...). */
  population: number;
  /** All numeric figures the dataset provides for this row. */
  metrics: Record<string, number>;
  /** Provider id, e.g. "unhcr". */
  source: string;
  /** ISO timestamp of when this data was fetched/normalized. */
  last_updated: string;
  dataset: DatasetId;
}

export interface CountryRef {
  name: string;
  /** ISO 3166-1 alpha-3. */
  iso3: string;
  /** ISO 3166-1 alpha-2, when known. */
  iso2?: string;
  region?: string;
  subregion?: string;
}

export interface CountryMatch extends CountryRef {
  /** 0..1 — how well the query matched. */
  score: number;
}

export interface SearchQuery {
  query: string;
  limit?: number;
}

export interface ListQuery {
  dataset: DatasetId;
  /**
   * Filter by country of asylum (ISO3). For datasets without the
   * origin/asylum distinction this is "the country".
   */
  asylum_iso3?: string;
  /** Filter by country of origin (ISO3). */
  origin_iso3?: string;
  yearFrom?: number;
  yearTo?: number;
  /**
   * How rows should be broken down:
   *  - 'asylum': one row per country of asylum
   *  - 'origin': one row per country of origin
   *  - 'none' (default): aggregate over the unfiltered dimension(s)
   */
  groupBy?: 'asylum' | 'origin' | 'none';
  /** 1-based page. */
  page?: number;
  /** Rows per page (provider may clamp). */
  limit?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  /** Total pages when the provider reports it, else undefined. */
  maxPages?: number;
  /** Total rows when the provider reports it, else undefined. */
  total?: number;
}

export interface DatasetDescriptor {
  id: DatasetId;
  title: string;
  description: string;
  /** Metric keys this dataset emits in `NormalizedRecord.metrics`. */
  metrics: readonly string[];
  citation: string;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  homepage: string;
  datasets: DatasetDescriptor[];
  attribution: string;
  terms: string;
}

/** Query for human-readable documents (situation reports, ...). */
export interface DocumentQuery {
  /** Restrict to documents about one country (ISO3). */
  iso3?: string;
  /** Free-text query over the document title and body. */
  query?: string;
  yearFrom?: number;
  yearTo?: number;
  /** Max documents to return (provider may clamp). */
  limit?: number;
}

/** One human-readable document, e.g. a situation report on ReliefWeb. */
export interface DocumentItem {
  title: string;
  /** Canonical public URL of the document. */
  url: string;
  /** Publishing organisation(s), comma-joined. */
  source: string;
  /** ISO date of original publication (empty when the source omits it). */
  date: string;
  country_code?: string;
  format?: string;
}

export interface ProviderHealth {
  provider: string;
  ok: boolean;
  latencyMs?: number;
  detail: string;
  checkedAt: string;
}

/**
 * The contract every provider module implements.
 *
 * All methods are read-only: this platform never modifies external data.
 */
export interface HumanitarianProvider {
  readonly id: string;
  readonly name: string;

  /** Free-text search over the provider's entities (countries, for UNHCR). */
  search(query: SearchQuery): Promise<CountryMatch[]>;

  /** Resolve a single country by ISO3/name; null when unknown. */
  get(ref: string): Promise<CountryRef | null>;

  /** Full country reference list, when the provider can enumerate one. */
  countries?(): Promise<CountryRef[]>;

  /**
   * Human-readable documents (situation reports, ...), newest first, when the
   * provider serves any. Optional like {@link countries} — tools must check.
   */
  documents?(query: DocumentQuery): Promise<DocumentItem[]>;

  /** List normalized records for a dataset, with filters and pagination. */
  list(query: ListQuery): Promise<Page<NormalizedRecord>>;

  /** Static metadata: datasets served, attribution, terms. */
  metadata(): Promise<ProviderMetadata>;

  /** Cheap liveness probe against the upstream API. */
  health(): Promise<ProviderHealth>;

  /** Convert one raw upstream payload into normalized records. Pure. */
  normalize(raw: unknown, dataset: DatasetId): NormalizedRecord[];
}
