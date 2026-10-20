# Security Policy

## Scope

malja-mcp is a **read-only** bridge to public humanitarian APIs. It
holds no credentials, stores no personal data, and never writes to upstream
systems. The attack surface is therefore small but real:

- the local HTTP mode (`--http`) — intended for local demos, unauthenticated
  by design; do not expose it to the public internet as-is
- cache poisoning via a compromised upstream or man-in-the-middle
- dependency supply chain (two runtime deps: the MCP SDK and zod)

## Reporting a vulnerability

Please open a **private security advisory** on GitHub
(Security → Advisories → Report a vulnerability) rather than a public issue.
You can expect an initial response within a week.

## Hardening notes for deployers

- Run the stdio transport for desktop use; it exposes nothing on the network.
- If you deploy `--http`, put it behind your own auth/reverse proxy and set
  `MALJA_RATE_LIMIT_RPS` conservatively.
- `MALJA_OFFLINE=1` with a pre-warmed SQLite cache gives you a fully
  air-gapped deployment.
