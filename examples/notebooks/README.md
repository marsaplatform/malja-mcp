# Runnable analysis notebooks

Reproducible research workflows against a **local** humanitarian-mcp server —
the same tool calls an AI assistant makes, driven from Python or R.

## Setup (one terminal)

```bash
git clone https://github.com/ahmedvnabil/humanitarian-mcp
cd humanitarian-mcp && npm install && npm run dashboard
# → http://localhost:8642  (leave it running)
```

The notebooks talk to the dashboard's `POST /api/call` endpoint, which drives
a real in-process MCP client — responses are exactly what Claude or any MCP
client sees, including `structuredContent` and extraction manifests.

## Notebooks

| File                          | Language | Workflows                                                                                   |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `humanitarian_analysis.ipynb` | Python   | Event study (Sudan 2023) · recognition rates · per-capita ranking · conflict × displacement |
| `humanitarian_analysis.Rmd`   | R        | Same four workflows in R                                                                    |

Python needs `pandas`, `requests`, `statsmodels`, `matplotlib`
(`pip install pandas requests statsmodels matplotlib`).
R needs `httr2`, `jsonlite` (`install.packages(c("httr2", "jsonlite"))`).

The conflict × displacement workflow needs the `hdx` provider — start the
server with `HMCP_PROVIDERS=unhcr,worldbank,hdx HMCP_HDX_APP_ID=<id> npm run dashboard`
(free identifier: see `.env.example`). The other three run with the defaults.
