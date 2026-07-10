# Connecting over Streamable HTTP

Start the server:

```bash
npm run dashboard    # serves POST /mcp + the dashboard on :8642
```

> Every snippet below also works against the hosted endpoint — replace
> `http://localhost:8642/mcp` with `https://humanitarian-mcp.zad.tools/mcp`
> (no key required; see the README's "Two ways to use it").

## From the TypeScript SDK

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:8642/mcp')));

const top = await client.callTool({
  name: 'top_host_countries',
  arguments: { limit: 5 },
});
console.log(top.structuredContent);
```

## From curl (raw JSON-RPC)

```bash
# initialize
curl -s -X POST http://localhost:8642/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"curl","version":"0"}}}'

# call a tool (stateless mode: no session header needed)
curl -s -X POST http://localhost:8642/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"latest_statistics","arguments":{"country":"Uganda"}}}'
```

The endpoint is stateless — every request is self-contained, which makes it
trivially load-balanceable. For local desktop clients prefer stdio (see
`examples/claude-desktop-config.json`).
