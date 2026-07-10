# Contributing

Thanks for helping make humanitarian data more accessible to AI assistants.

## Getting started

```bash
git clone https://github.com/ahmedvnabil/humanitarian-mcp
cd humanitarian-mcp
npm install
npm run check        # typecheck + lint + format + tests must pass
```

## What we're looking for

1. **New providers** — most wanted: **ReliefWeb** (situation reports,
   disasters, jobs — a documented scaffold with implementation notes already
   sits in `src/providers/reliefweb/`). Also welcome: UNHCR ODP situations,
   OWID, UNICEF, WHO. Follow
   [docs/adding-providers.md](docs/adding-providers.md) end to end; PRs
   without fixture-based tests won't be merged. (UNHCR, World Bank and
   HDX/HAPI are already live — study them as worked examples.)
2. **Data-quality fixes** — normalization edge cases, better country aliases
   (English and Arabic — see `src/shared/country-names-ar.ts`), centroid
   corrections.
3. **New tools/resources/prompts** — must be provider-agnostic, read-only,
   and covered by the compliance suite.
4. **Docs & examples** — clearer examples, corrections, translations,
   analysis notebooks (`examples/notebooks/`).

Not sure where to start? Open a
[provider request](https://github.com/ahmedvnabil/humanitarian-mcp/issues/new/choose)
or pick anything labelled `help wanted`.

## Rules of the road

- **Read-only, always.** No tool may mutate external systems.
- **Provider isolation.** Provider-specific logic stays inside
  `src/providers/<id>/`.
- **No network in tests.** Record fixtures instead.
- **Respect the data's subjects.** These figures represent displaced people.
  Attribution (UNHCR et al.) is not optional; sensationalism is not welcome.
- **TypeScript strict, ESLint, Prettier** — `npm run lint:fix && npm run format`
  before committing.

## PR checklist

- [ ] `npm run check` passes
- [ ] New behavior has tests (unit for pure logic, compliance/integration for surface changes)
- [ ] Docs updated (README table, docs/tools.md, .env.example as applicable)
- [ ] Commit messages follow `type: description` (feat, fix, refactor, docs, test, chore)

## Reporting issues

Include the tool name, arguments, expected vs actual output, and — if data
looks wrong — a link to the corresponding view at the source
([UNHCR Refugee Data Finder](https://www.unhcr.org/refugee-statistics/),
[World Bank data](https://data.worldbank.org/), or
[HDX](https://data.humdata.org/)) so we can tell a normalization bug from an
upstream revision.

## Releases (maintainers)

Version bump (`package.json` + `SERVER_VERSION` in `src/config.ts` +
`manifest.json` + `CITATION.cff`), update `CHANGELOG.md`, then tag `v*` and
push — the release workflow runs the full check and publishes the GitHub
release with the `.mcpb` bundle, the Docker image to GHCR, and (once the npm
token is configured) the npm package. See
[docs/development.md](docs/development.md).
