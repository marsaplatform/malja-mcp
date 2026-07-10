# How MCP works (using this server as the example)

The [Model Context Protocol](https://modelcontextprotocol.io) is an open
standard that lets AI applications plug into external systems the way editors
plug into language servers via LSP. One protocol, any client, any server.

## The three primitives

### Tools — "things the model can do"

A tool is a typed function the model may call. This server registers 20, e.g.:

```
tools/call → { name: "refugee_population",
               arguments: { country: "Egypt", year_from: 2020 } }
```

The server validates arguments against the tool's JSON Schema (generated from
zod), runs the handler, and returns:

- `content` — human-readable blocks (markdown tables here),
- `structuredContent` — machine-readable JSON validated against the tool's
  declared `outputSchema`,
- `isError: true` — when something went wrong, with a message the model can
  react to (retry, call `search_country` first, etc.).

### Resources — "things the model can read"

Resources are addressable, read-only documents. Clients list them and read by
URI. This server exposes static ones (`metadata://providers`) and **resource
templates** (`country://{code}`) whose variables support autocompletion — type
`egy` and the server completes `EGY`.

### Prompts — "conversation starters the server ships"

Parameterized message templates the client surfaces in its UI. `donor_briefing`
takes a `country` argument and expands to instructions that steer the model
through the right tool sequence with the right output format.

## The wire

MCP is JSON-RPC 2.0 over a transport:

- **stdio** — the client spawns `node dist/index.js` and pipes JSON-RPC through
  stdin/stdout. That's why this server never prints logs to stdout.
- **Streamable HTTP** — a single `/mcp` endpoint accepting POSTed JSON-RPC,
  optionally streaming responses via SSE. Run `npm run dashboard` and try it:

```bash
curl -X POST http://localhost:8642/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"curl","version":"0"}}}'
```

## The lifecycle

1. **initialize** — client and server exchange versions, capabilities and
   server `instructions` (this server's instructions teach the
   asylum-vs-origin convention up front).
2. **Discovery** — `tools/list`, `resources/list`, `resources/templates/list`,
   `prompts/list`.
3. **Use** — `tools/call`, `resources/read`, `prompts/get`, `completion/complete`.
4. **Notifications** — during long calls the server pushes
   `notifications/progress` (try `generate_country_report`; this server emits
   five progress steps).

## Why an MCP server instead of "just call the REST API"?

Compare what the model must know:

|                       | Raw UNHCR REST                  | This MCP server              |
| --------------------- | ------------------------------- | ---------------------------- |
| Country codes         | UNHCR-internal (`ARE` = Egypt!) | names or ISO3, fuzzy-matched |
| "Top hosts"           | know `coa_all=true`             | `top_host_countries`         |
| Cell values           | numbers, strings, `"-"`         | clean numbers, always        |
| Errors                | silently empty `items`          | actionable error text        |
| Rate limits & retries | model's problem                 | handled, invisible           |
| Attribution           | remember to add it              | in every payload             |

The same pattern generalizes: GitHub MCP hides the GitHub REST/GraphQL split,
Slack MCP hides cursor pagination. **Humanitarian MCP hides humanitarian-data
plumbing.** That is the entire job of a good MCP server.
