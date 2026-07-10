# Development guide

## Setup

```bash
npm install
npm run dev          # stdio server via tsx (for MCP clients)
npm run dev:http     # HTTP mode + dashboard on :8642
npm run inspect      # MCP Inspector against the dev server
```

Node ≥ 20 required. The SQLite cache backend needs Node ≥ 22.5 (`node:sqlite`);
on older versions it falls back to memory with a warning.

## Everyday commands

| Command                               | Does                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `npm run check`                       | typecheck + lint + format check + tests — run before pushing |
| `npm test`                            | vitest, all suites                                           |
| `npm run test:watch`                  | vitest watch mode                                            |
| `npm run test:coverage`               | v8 coverage report                                           |
| `npm run lint:fix` / `npm run format` | auto-fix style                                               |
| `npm run build`                       | emit `dist/` (what the `humanitarian-mcp` bin runs)          |

## Test layout

```
tests/
├── fixtures/              recorded API responses (the upstream contracts)
│   ├── unhcr/  worldbank/  hdx/
├── helpers/
│   ├── mock-provider.ts   deterministic provider for integration tests
│   └── context.ts         AppContext wired for tests (silent, memory-only)
├── unit/                  normalize · stats · cache · http-client ·
│                          rate-limiter · country-match · country-names-ar ·
│                          viz · config
└── integration/
    ├── mcp-compliance.test.ts      real SDK client ↔ real server, in-memory
    ├── tool-surface.test.ts        every tool against the mock provider
    ├── unhcr-provider.test.ts      ┐
    ├── worldbank-provider.test.ts  ├ provider ↔ fixture-stubbed fetch
    └── hdx-provider.test.ts        ┘
```

Principles:

- **No network in tests.** Anything upstream is a recorded fixture.
- **The compliance suite is the spec.** It asserts the full tool/resource/
  prompt surface, structured outputs, pagination, progress notifications and
  error semantics through the official SDK client — if it passes, any MCP
  client works.
- **Fixtures are immutable.** When UNHCR changes a payload, record a new
  fixture alongside the old one and update `normalize.ts` to handle both.

## Debugging

- Logs are JSON on **stderr** (stdout belongs to JSON-RPC). `HMCP_LOG_LEVEL=debug`
  shows cache and retry decisions.
- `npm run dashboard` gives you live logs, per-tool latency and a query
  playground without any MCP client.
- Reproduce a client call quickly:

```bash
curl -s -X POST http://localhost:8642/api/call \
  -H 'content-type: application/json' \
  -d '{"tool":"trend_analysis","arguments":{"country":"Sudan","role":"origin"}}'
```

- `HMCP_OFFLINE=1` + a warmed SQLite cache is the fastest way to iterate on
  tool formatting without hammering the API.

## Style

- TypeScript strict; ESLint (typescript-eslint) + Prettier are the source of
  truth — don't argue with them, run `npm run lint:fix`.
- Files stay focused (one tool group per file); public APIs carry doc comments.
- No `console.log` — use the injected `Logger`.
- Errors thrown across layers are typed (`ProviderError`, `CountryNotFoundError`);
  the tool wrapper translates them for the model.

## Release

Releases are tag-driven and automated (`.github/workflows/release.yml`):

1. Bump the version in **four places** (they must stay in sync):
   `package.json` (`npm version x.y.z --no-git-tag-version`),
   `SERVER_VERSION` in `src/config.ts`, `manifest.json` (the `.mcpb`
   manifest), and `CITATION.cff`.
2. Add a `CHANGELOG.md` section.
3. Sanity check locally:

   ```bash
   npm run check && npm run build
   node dist/index.js --version
   ```

4. Tag and push: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`.

The workflow then runs the full check and publishes: the GitHub release with
`humanitarian-mcp.mcpb` attached, the Docker image to
`ghcr.io/ahmedvnabil/humanitarian-mcp` (version + `latest`), and — once the
`NPM_TOKEN` repository secret exists — the npm package with provenance.

`files` in package.json ships only `dist`, README and LICENSE.
