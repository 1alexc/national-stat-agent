# MCP Servers (`mcp/`)

This directory contains two local stdio Model Context Protocol (MCP) servers used by the UK Stat Agent multi-agent pipeline:

1. **UK ONS MCP Server (`mcp/uk-ons-mcp-server/`)**:
   - TypeScript/Node.js MCP server (`dist/index.js`) connecting to the official UK Office for National Statistics (ONS) beta API (`https://api.beta.ons.gov.uk/v1`).
   - Exposes 7 read-only statistical tools to `research_agent`:
     - `list_datasets`
     - `search_datasets`
     - `get_dataset`
     - `get_dataset_dimensions`
     - `get_dimension_options`
     - `get_observation`
     - `get_latest_data`
   - Build / test standalone:
     ```bash
     cd mcp/uk-ons-mcp-server
     npm install && npm run build
     npm test
     ```

2. **Social Publishing MCP Server (`mcp/linkedin_server.py`)**:
   - FastMCP stdio server exposing `get_profile()` and `create_post(text, image_path?, platform?)` (supports X/Twitter and LinkedIn in `DRY_RUN=true` mode, plus live LinkedIn Posts API when `DRY_RUN=false`, alongside remote Buffer MCP for scheduled/live X & multi-channel publishing).
   - With `DRY_RUN=true` (the default) it logs the payload and returns a fake post URL — nothing touches external social feeds. Set `DRY_RUN=false` only for single happy-path verification, then flip it back.

```bash
# standalone smoke test (from the repo root)
DRY_RUN=true uv run python mcp/linkedin_server.py   # then speak MCP over stdio, or:
npx @modelcontextprotocol/inspector uv run python mcp/linkedin_server.py
```

## LinkedIn Developer app setup

1. **Create the app**: https://www.linkedin.com/developers/apps → *Create app*.
   You need a LinkedIn *company page* to associate (create a dummy one if needed).
2. **Add products** (Products tab, both are instant self-serve approval):
   - **Share on LinkedIn** → grants `w_member_social`
   - **Sign In with LinkedIn using OpenID Connect** → grants `openid`, `profile`
3. **Auth tab**: note *Client ID* and *Client Secret*; add a redirect URL, e.g.
   `http://localhost:3000/callback` (it never needs to serve anything).

## Getting a 3-legged OAuth token

1. Open in a browser (one line, fill in CLIENT_ID):

   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=openid%20profile%20w_member_social
   ```

2. Approve; you land on `localhost:3000/callback?code=...` (page won't load —
   fine). Copy the `code` from the URL bar. **It expires in ~30 minutes.**

3. Exchange it:

   ```bash
   curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
     -d grant_type=authorization_code \
     -d code=THE_CODE \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d redirect_uri=http://localhost:3000/callback
   ```

4. The response's `access_token` (valid ~60 days) goes in your `.env`:

   ```
   LINKEDIN_ACCESS_TOKEN=...
   DRY_RUN=true
   ```

## Verify the happy path ONCE

```bash
DRY_RUN=false LINKEDIN_ACCESS_TOKEN=... uv run python -c "
import importlib.util as u
s = u.spec_from_file_location('linkedin_server', 'mcp/linkedin_server.py')
m = u.module_from_spec(s); s.loader.exec_module(m)
print(m.create_post.fn('Testing my ADK DevCamp posting pipeline. If you can read this, it worked.'))
"
```

Then set `DRY_RUN=true` and leave it forever.
