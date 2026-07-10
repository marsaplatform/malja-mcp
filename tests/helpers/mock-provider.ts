import { matchCountries } from '../../src/shared/country-match.js';
import type {
  CountryMatch,
  CountryRef,
  DatasetId,
  DocumentItem,
  DocumentQuery,
  HumanitarianProvider,
  ListQuery,
  NormalizedRecord,
  Page,
  ProviderHealth,
  ProviderMetadata,
  SearchQuery,
} from '../../src/providers/types.js';

/**
 * Deterministic in-memory provider used by integration tests: no network,
 * stable numbers, same contract as a real provider.
 */

const COUNTRIES: CountryRef[] = [
  { name: 'Egypt', iso3: 'EGY', iso2: 'EG', region: 'Africa' },
  { name: 'Jordan', iso3: 'JOR', iso2: 'JO', region: 'Asia' },
  { name: 'Syrian Arab Rep.', iso3: 'SYR', iso2: 'SY', region: 'Asia' },
  { name: 'Sudan', iso3: 'SDN', iso2: 'SD', region: 'Africa' },
];

const ALIASES: Record<string, string[]> = {
  SYR: ['syria'],
};

function populationRecord(country: CountryRef, year: number, refugees: number): NormalizedRecord {
  return {
    country: country.name,
    country_code: country.iso3,
    asylum: country.name,
    asylum_code: country.iso3,
    year,
    population: refugees + 1000,
    metrics: { refugees, asylum_seekers: 1000 },
    source: 'mock',
    last_updated: '2026-01-01T00:00:00.000Z',
    dataset: 'population',
  };
}

/** Refugees hosted: deterministic ramp per country so trends are testable. */
function refugeesFor(iso3: string, year: number): number {
  const base: Record<string, number> = { EGY: 100_000, JOR: 600_000, SYR: 10_000, SDN: 800_000 };
  return (base[iso3] ?? 50_000) + (year - 2015) * 10_000;
}

/** Constant context indicators so per-capita maths is hand-checkable. */
const NATIONAL_POPULATION: Record<string, number> = {
  EGY: 110_000_000,
  JOR: 11_000_000,
  SYR: 22_000_000,
  SDN: 48_000_000,
};

const GDP_USD: Record<string, number> = {
  EGY: 400e9,
  JOR: 50e9,
  SYR: 9e9,
  SDN: 30e9,
};

export class MockProvider implements HumanitarianProvider {
  readonly id = 'mock';
  readonly name = 'Mock Provider';

  search(query: SearchQuery): Promise<CountryMatch[]> {
    const candidates = COUNTRIES.map((c) => ({
      value: c,
      names: [c.name, c.iso3, ...(c.iso2 ? [c.iso2] : []), ...(ALIASES[c.iso3] ?? [])],
    }));
    return Promise.resolve(
      matchCountries(query.query, candidates, query.limit ?? 5).map((m) => ({
        ...m.value,
        score: m.score,
      })),
    );
  }

  get(ref: string): Promise<CountryRef | null> {
    const upper = ref.toUpperCase();
    return Promise.resolve(COUNTRIES.find((c) => c.iso3 === upper) ?? null);
  }

  countries(): Promise<CountryRef[]> {
    return Promise.resolve([...COUNTRIES]);
  }

  list(query: ListQuery): Promise<Page<NormalizedRecord>> {
    const yearFrom = query.yearFrom ?? 2015;
    const yearTo = Math.min(query.yearTo ?? 2024, 2024);
    let records: NormalizedRecord[] = [];

    if (query.dataset === 'population') {
      const asylumFilter = query.asylum_iso3?.toUpperCase();
      const subjects = asylumFilter
        ? COUNTRIES.filter((c) => c.iso3 === asylumFilter)
        : query.groupBy === 'asylum' || query.groupBy === 'origin'
          ? COUNTRIES
          : [{ name: 'All countries', iso3: '', region: undefined } as unknown as CountryRef];
      for (let year = yearFrom; year <= yearTo; year++) {
        for (const subject of subjects) {
          records.push(
            populationRecord(
              subject,
              year,
              subject.iso3 ? refugeesFor(subject.iso3, year) : 5_000_000,
            ),
          );
        }
      }
      if (query.origin_iso3) {
        // Mock keeps it simple: origin filters return the same shaped data.
        records = records.map((r) => ({
          ...r,
          origin: 'Syrian Arab Rep.',
          origin_code: 'SYR',
        }));
      }
    } else if (query.dataset === 'context-indicators') {
      const iso3 = (query.asylum_iso3 ?? query.origin_iso3)?.toUpperCase();
      const subjects = iso3 ? COUNTRIES.filter((c) => c.iso3 === iso3) : COUNTRIES;
      for (let year = yearFrom; year <= yearTo; year++) {
        for (const subject of subjects) {
          const population = NATIONAL_POPULATION[subject.iso3] ?? 10_000_000;
          const gdp = GDP_USD[subject.iso3] ?? 20e9;
          records.push({
            country: subject.name,
            country_code: subject.iso3,
            year,
            population,
            metrics: {
              national_population: population,
              gdp_usd: gdp,
              gdp_per_capita_usd: gdp / population,
            },
            source: 'mock',
            last_updated: '2026-01-01T00:00:00.000Z',
            dataset: 'context-indicators',
          });
        }
      }
    } else if (query.dataset === 'conflict-events') {
      const iso3 = (query.asylum_iso3 ?? query.origin_iso3 ?? 'SDN').toUpperCase();
      const country = COUNTRIES.find((c) => c.iso3 === iso3);
      if (country) {
        for (let year = yearFrom; year <= yearTo; year++) {
          const events = 100 + (year - 2015) * 10;
          records.push({
            country: country.name,
            country_code: country.iso3,
            year,
            population: events,
            metrics: { events, fatalities: events * 2 },
            source: 'mock',
            last_updated: '2026-01-01T00:00:00.000Z',
            dataset: 'conflict-events',
          });
        }
      }
    } else if (query.dataset === 'humanitarian-funding') {
      const iso3 = (query.asylum_iso3 ?? query.origin_iso3 ?? 'SDN').toUpperCase();
      const country = COUNTRIES.find((c) => c.iso3 === iso3);
      if (country) {
        for (let year = Math.max(yearFrom, 2020); year <= yearTo; year++) {
          const funding = 250_000_000 + (year - 2020) * 10_000_000;
          records.push({
            country: country.name,
            country_code: country.iso3,
            year,
            population: funding,
            metrics: {
              requirements_usd: 500_000_000,
              funding_usd: funding,
              funding_coverage_pct: Number(((funding / 500_000_000) * 100).toFixed(1)),
            },
            source: 'mock',
            last_updated: '2026-01-01T00:00:00.000Z',
            dataset: 'humanitarian-funding',
          });
        }
      }
    } else if (query.dataset === 'food-security') {
      const iso3 = (query.asylum_iso3 ?? query.origin_iso3 ?? 'SDN').toUpperCase();
      const country = COUNTRIES.find((c) => c.iso3 === iso3);
      if (country && yearFrom <= 2024 && yearTo >= 2024) {
        records.push({
          country: country.name,
          country_code: country.iso3,
          year: 2024,
          population: 700_000,
          metrics: {
            ipc_phase_1: 1_000_000,
            ipc_phase_2: 800_000,
            ipc_phase_3: 500_000,
            ipc_phase_4: 180_000,
            ipc_phase_5: 20_000,
            ipc_phase_3plus: 700_000,
            analyzed_population: 2_500_000,
          },
          source: 'mock',
          last_updated: '2026-01-01T00:00:00.000Z',
          dataset: 'food-security',
        });
      }
    } else if (query.dataset === 'situation-reports') {
      const iso3 = (query.asylum_iso3 ?? query.origin_iso3 ?? 'SDN').toUpperCase();
      const country = COUNTRIES.find((c) => c.iso3 === iso3);
      if (country) {
        for (let year = yearFrom; year <= yearTo; year++) {
          const reports = 12 + (year - 2015);
          records.push({
            country: country.name,
            country_code: country.iso3,
            year,
            population: reports,
            metrics: { reports },
            source: 'mock',
            last_updated: '2026-01-01T00:00:00.000Z',
            dataset: 'situation-reports',
          });
        }
      }
    } else if (query.dataset === 'demographics') {
      const iso3 = (query.asylum_iso3 ?? query.origin_iso3 ?? 'EGY').toUpperCase();
      const country = COUNTRIES.find((c) => c.iso3 === iso3);
      if (country) {
        records.push({
          country: country.name,
          country_code: country.iso3,
          year: 2024,
          population: 200_000,
          metrics: {
            f_0_4: 10_000,
            f_5_11: 15_000,
            f_12_17: 12_000,
            f_18_59: 50_000,
            f_60: 8_000,
            f_total: 95_000,
            m_0_4: 11_000,
            m_5_11: 16_000,
            m_12_17: 13_000,
            m_18_59: 57_000,
            m_60: 8_000,
            m_total: 105_000,
            total: 200_000,
          },
          source: 'mock',
          last_updated: '2026-01-01T00:00:00.000Z',
          dataset: 'demographics',
        });
      }
    } else {
      const iso3 = (query.asylum_iso3 ?? 'EGY').toUpperCase();
      const country = COUNTRIES.find((c) => c.iso3 === iso3);
      if (country) {
        for (let year = Math.max(yearFrom, 2020); year <= yearTo; year++) {
          const metrics: Record<string, number> =
            query.dataset === 'asylum-applications'
              ? { applied: 20_000 + (year - 2020) * 1_000 }
              : {
                  dec_recognized: 8_000,
                  dec_other: 500,
                  dec_rejected: 1_500,
                  dec_closed: 2_000,
                  dec_total: 12_000,
                };
          records.push({
            country: country.name,
            country_code: country.iso3,
            asylum: country.name,
            asylum_code: country.iso3,
            year,
            population: metrics['applied'] ?? metrics['dec_total'] ?? 0,
            metrics,
            source: 'mock',
            last_updated: '2026-01-01T00:00:00.000Z',
            dataset: query.dataset,
          });
        }
      }
    }

    const limit = query.limit ?? 100;
    const page = query.page ?? 1;
    const start = (page - 1) * limit;
    return Promise.resolve({
      items: records.slice(start, start + limit),
      page,
      maxPages: Math.max(1, Math.ceil(records.length / limit)),
      total: records.length,
    });
  }

  metadata(): Promise<ProviderMetadata> {
    return Promise.resolve({
      id: this.id,
      name: this.name,
      description: 'Deterministic fixture data for tests',
      homepage: 'https://example.test',
      datasets: (
        [
          'population',
          'demographics',
          'asylum-applications',
          'asylum-decisions',
          'context-indicators',
          'conflict-events',
          'humanitarian-funding',
          'food-security',
          'situation-reports',
        ] as DatasetId[]
      ).map((id) => ({
        id,
        title: id,
        description: `mock ${id}`,
        metrics: ['refugees'],
        citation: 'mock',
      })),
      attribution: 'Mock data — tests only',
      terms: 'https://example.test/terms',
    });
  }

  documents(query: DocumentQuery): Promise<DocumentItem[]> {
    const iso3 = (query.iso3 ?? 'SDN').toUpperCase();
    const country = COUNTRIES.find((c) => c.iso3 === iso3);
    if (!country) return Promise.resolve([]);
    const year = Math.min(query.yearTo ?? 2024, 2024);
    const items = [1, 2, 3].map((n) => ({
      title: `${country.name} Situation Report No. ${n}${query.query ? ` — ${query.query}` : ''}`,
      url: `https://example.test/report/${iso3.toLowerCase()}/${year}-${n}`,
      source: 'MOCK',
      date: `${year}-0${n}-01T00:00:00+00:00`,
      country_code: iso3,
      format: 'Situation Report',
    }));
    return Promise.resolve(items.slice(0, query.limit ?? 5));
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      provider: this.id,
      ok: true,
      latencyMs: 1,
      detail: 'mock always healthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  normalize(raw: unknown, dataset: DatasetId): NormalizedRecord[] {
    void dataset;
    return Array.isArray(raw) ? (raw as NormalizedRecord[]) : [];
  }
}
