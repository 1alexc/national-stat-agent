# UK ONS MCP Server

[![npm version](https://badge.fury.io/js/uk_ons_mcp_server.svg)](https://badge.fury.io/js/uk_ons_mcp_server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-dwain--barnes-blue)](https://github.com/dwain-barnes/uk-ons-mcp-server)

A **Model Context Protocol (MCP) server** for the UK Office for National Statistics (ONS) **CMD API** (`https://api.beta.ons.gov.uk/v1`).
Query official UK government statistics — inflation, GDP, wellbeing, trade, deaths and more — straight from your MCP-compatible assistant. No API key required.

---

## Features

- **Direct ONS access** — no authentication, no tokens
- **Browse & search** the full published dataset catalogue
- **Dimension discovery** — inspect a dataset's dimensions and valid option codes before querying
- **Real observations** — pull data points filtered by geography, time and any other dimension
- **Latest-data shortcut** that auto-fills sensible defaults
- **TypeScript, native `fetch`, zero runtime deps** beyond the MCP SDK and Zod
- **Input validation** and actionable, self-correcting error messages

---

## Requirements

- **Node.js >= 18.17** (uses the global `fetch` and `AbortSignal.timeout`)

---

## Recommended agent workflow

The ONS observations endpoint requires a value for **every** dimension of a dataset, and allows **exactly one** wildcard `*`. The intended flow is:

1. **`search_datasets`** — find a dataset id by keyword (e.g. `"inflation"` -> `cpih01`).
2. **`get_dataset_dimensions`** — learn the required dimensions and see sample option codes.
3. **`get_observation`** — request data, giving each dimension a value and using `*` for the one you want to vary.

`get_latest_data` is a convenience wrapper: it auto-fills `time="*"` and `geography="K02000001"` (UK) and any single-option dimension. If a dataset needs more choices, it returns the available options so you can switch to `get_observation`.

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `list_datasets` | Paginated list of all datasets (`limit` 1-1000, `offset`). |
| `search_datasets` | Keyword search over id/title/description/keywords. |
| `get_dataset` | Full metadata for one dataset by id. |
| `get_dataset_dimensions` | Dimensions of a dataset's latest version, with option counts and samples. **Call before `get_observation`.** |
| `get_dimension_options` | Page through the full list of valid option codes for one dimension. |
| `get_observation` | Retrieve observations. Every dimension needs a value; exactly one may be `*`. |
| `get_latest_data` | Latest observations with auto-filled `time="*"` / `geography=UK` defaults. |

### Resources

| URI | Description |
|-----|-------------|
| `ons://popular_datasets` | Curated, live-verified list of common dataset ids. |
| `ons://api_info` | API base URL, auth model and the recommended workflow. |

---

## Example

Query CPIH (UK inflation) as a UK-wide time series:

```jsonc
// 1) discover dimensions
get_dataset_dimensions { "dataset_id": "cpih01" }
// -> dimensions: aggregate (122 options, e.g. CP00 "Overall Index"), geography, time

// 2) fetch the Overall Index across all time periods for the UK
get_observation {
  "dataset_id": "cpih01",
  "dimensions": { "time": "*", "geography": "K02000001", "aggregate": "CP00" }
}
```

Omitting a required dimension returns a helpful error listing what is missing and sample codes to use, so an agent can retry without guessing.

---

## Installation & configuration

### Option A — npx (published package)

No install step; the client runs it on demand.

**Claude Desktop** (`claude_desktop_config.json`) or **Claude Code** (`.mcp.json`):

```json
{
  "mcpServers": {
    "uk-ons": {
      "command": "npx",
      "args": ["-y", "uk_ons_mcp_server"]
    }
  }
}
```

### Option B — local build (from source)

```bash
git clone https://github.com/dwain-barnes/uk-ons-mcp-server.git
cd uk-ons-mcp-server
npm install
npm run build
```

Then point your client at the built entry point (use an absolute path):

```json
{
  "mcpServers": {
    "uk-ons": {
      "command": "node",
      "args": ["/absolute/path/to/uk_ons_mcp_server/dist/index.js"]
    }
  }
}
```

On Windows, use a full path such as `C:\\Users\\you\\uk_ons_mcp_server\\dist\\index.js`.

Claude Code can also add it from the CLI:

```bash
claude mcp add uk-ons -- node /absolute/path/to/uk_ons_mcp_server/dist/index.js
```

---

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm start         # run the built server on stdio
npm run dev       # tsc --watch
npm run clean     # remove dist/
npm test          # build, then run the end-to-end smoke test against the live API
```

The smoke test (`test/smoke.mjs`) spawns the built server over stdio with the MCP SDK client and checks all seven tools plus a resource end-to-end.

---

## Security notes

- **Read-only.** Every tool only performs `GET` requests against the public ONS API; nothing is written or mutated.
- **No authentication or secrets.** The ONS CMD API is open and keyless, so there are no tokens to store or leak.
- **Input validation.** Dataset ids, editions, versions and dimension names are validated against a strict character set (`[A-Za-z0-9._-]`, max 100 chars) and every path/query value is URL-encoded before a request is made. Dimension values may additionally be the single wildcard `*`.
- **Bounded responses.** Observation results are capped (with a `truncated` flag and total count) to avoid overwhelming the model's context.

---

## License

MIT — see [`LICENSE`](./LICENSE).

---

> **Disclaimer**
> This project is **unofficial** and not endorsed by the UK Office for National Statistics. Data usage remains subject to ONS terms and the Open Government Licence.
