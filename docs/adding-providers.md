# Adding a provider

A provider is one directory under `src/providers/<id>/` implementing one
interface. Nothing else in the codebase changes except a `switch` arm in
`src/context.ts`. This guide walks through a hypothetical **World Bank**
provider; the real World Bank, HDX and ReliefWeb providers in the tree all
followed this exact plan.

## 0. Ground rules

- **Read-only.** Providers must never modify upstream data.
- **Nothing leaks.** Upstream quirks (codes, envelopes, auth) stay inside your
  directory. Everything you emit speaks ISO3 + `NormalizedRecord`.
- **Pure normalization.** `normalize.ts` is a pure function with fixture tests.
- **Be polite.** Use the shared `HttpClient` — it brings caching, rate
  limiting, retry and offline handling for free. Don't hand-roll `fetch`.

## 1. Layout

```
src/providers/worldbank/
├── client.ts      typed URL builder + endpoint wrapper (knows the REST shape)
├── normalize.ts   raw rows → NormalizedRecord[]         (pure)
├── index.ts       class WorldBankProvider implements HumanitarianProvider
└── (codes.ts)     only if the source has its own entity-code scheme
```

## 2. Implement the contract

```ts
// src/providers/worldbank/index.ts
import { HttpClient } from '../../shared/http.js';
import { RateLimiter } from '../../shared/rate-limiter.js';
import type { HumanitarianProvider /* … */ } from '../types.js';

export class WorldBankProvider implements HumanitarianProvider {
  readonly id = 'worldbank';
  readonly name = 'World Bank Open Data';

  private readonly client: WorldBankClient;

  constructor(config: Config, cache: InstrumentedCache, logger: Logger) {
    const http = new HttpClient({
      cache,
      config,
      logger,
      limiter: new RateLimiter(config.rateLimitRps),
      provider: this.id,
    });
    this.client = new WorldBankClient(http);
  }

  async search(query) {
    /* country autocomplete → CountryMatch[] */
  }
  async get(ref) {
    /* ISO3/name → CountryRef | null */
  }
  async list(query) {
    /* dataset + filters → Page<NormalizedRecord> */
  }
  async metadata() {
    /* datasets, attribution, terms */
  }
  async health() {
    /* cheap probe, return ok/latency/detail */
  }
  normalize(raw, ds) {
    /* pure: raw payload → NormalizedRecord[] */
  }
}
```

Implementation notes, hard-won from the UNHCR provider:

- **`search()`** powers `search_country` and country resolution everywhere.
  Reuse `matchCountries()` from `src/shared/country-match.ts` — pass every
  name, code and alias your source knows.
- **`list()`** receives ISO3 filters (`asylum_iso3` / `origin_iso3`), year
  bounds, `groupBy` and pagination. Translate to your source's parameters
  inside the provider. If your source uses non-ISO codes, build a cached index
  like `unhcr/codes.ts` and translate both directions (query params out,
  record codes in).
- **`normalize()`** must tolerate hostile cells. UNHCR sends `"-"` for
  missing; the World Bank sends `null`; some sources send `""`. Convert to
  clean numbers or omit the key — never emit `NaN`.
- **`health()`** should be cheap and cache-friendly (a tiny list request).
- Declare only datasets you actually serve in `metadata()` — the registry
  routes tools by dataset, so declaring `population` means every population
  tool will hit you.

## 3. Register it

```ts
// src/context.ts
case 'worldbank':
  registry.register(new WorldBankProvider(config, cache, logger));
  break;
```

Enable with `HMCP_PROVIDERS=unhcr,worldbank`. Registration order is priority
order when several providers serve the same dataset.

## 4. Test it

1. **Record fixtures once** (curl the real API, save JSON under
   `tests/fixtures/worldbank/`). Fixtures are the contract with upstream.
2. **Unit-test `normalize()`** against those fixtures, including the hostile
   cells (see `tests/unit/normalize.test.ts`).
3. **Integration-test the provider** with a stubbed `fetch` routing URLs to
   fixtures — assert the URL translation and the normalized output (see
   `tests/integration/unhcr-provider.test.ts`, especially the
   `EGY → coa=ARE` test; that class of bug is why these tests exist).
4. The **MCP compliance suite** runs against `MockProvider` and needs no
   changes unless you add new datasets.

## 5. Document it

- Add the provider to the README table and roadmap.
- State attribution and terms in `metadata()` — tools surface them to users.
- If the source needs an API key, read it from the environment in
  `config.ts` (never hardcode), document it in `.env.example`, and make
  `health()` explain a missing key clearly.

## Checklist

- [ ] `client.ts` — URLs and params only, via shared `HttpClient`
- [ ] `normalize.ts` — pure, fixture-tested, hostile-cell-proof
- [ ] `index.ts` — implements all six methods (+ optional `countries()`)
- [ ] No provider-specific types exported outside the directory
- [ ] Registered in `context.ts`, documented in README + `.env.example`
- [ ] Fixtures + unit + integration tests green: `npm run check`
