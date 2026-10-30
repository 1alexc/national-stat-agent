#!/usr/bin/env node
/**
 * End-to-end smoke test for the UK ONS MCP server.
 *
 * Spawns `node dist/index.js` over stdio using the MCP SDK client and exercises
 * every tool and one resource against the LIVE ONS API. Each check prints
 * PASS/FAIL with a short detail; the process exits 1 if any check fails.
 *
 * Run with: npm test   (which builds first)   or   node test/smoke.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));

let failures = 0;

function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function textOf(result) {
  const block = (result.content ?? []).find((c) => c.type === 'text');
  return block ? block.text : '';
}

function jsonOf(result) {
  return JSON.parse(textOf(result));
}

async function step(name, fn) {
  try {
    const { ok, detail } = await fn();
    report(name, ok, detail);
  } catch (err) {
    report(name, false, err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: 'ignore',
  });
  const client = new Client({ name: 'uk-ons-smoke-test', version: '1.0.0' });
  await client.connect(transport);

  try {
    // 1. tools/list returns 7 tools
    await step('tools/list returns 7 tools', async () => {
      const { tools } = await client.listTools();
      return { ok: tools.length === 7, detail: `${tools.length} tools: ${tools.map((t) => t.name).join(', ')}` };
    });

    // 2. list_datasets limit 2 -> 2 items
    await step('list_datasets limit 2 returns 2 items', async () => {
      const res = await client.callTool({ name: 'list_datasets', arguments: { limit: 2, offset: 0 } });
      const data = jsonOf(res);
      const n = data.datasets?.length ?? 0;
      return { ok: !res.isError && n === 2, detail: `datasets=${n}, total=${data.total}` };
    });

    // 3. get_dataset cpih01 -> has title
    await step('get_dataset cpih01 has title', async () => {
      const res = await client.callTool({ name: 'get_dataset', arguments: { dataset_id: 'cpih01' } });
      const data = jsonOf(res);
      return { ok: !res.isError && typeof data.title === 'string' && data.title.length > 0, detail: data.title };
    });

    // 4. search_datasets "wellbeing" -> >= 1 result
    await step('search_datasets "wellbeing" returns >= 1 result', async () => {
      const res = await client.callTool({ name: 'search_datasets', arguments: { query: 'wellbeing', limit: 10 } });
      const data = jsonOf(res);
      const n = data.datasets?.length ?? 0;
      return { ok: !res.isError && n >= 1, detail: `matches=${data.total_matches}, ids=${(data.datasets ?? []).map((d) => d.id).join(', ')}` };
    });

    // 5. get_dataset_dimensions cpih01 -> dims include aggregate + geography + time
    await step('get_dataset_dimensions cpih01 includes aggregate/geography/time', async () => {
      const res = await client.callTool({ name: 'get_dataset_dimensions', arguments: { dataset_id: 'cpih01' } });
      const data = jsonOf(res);
      const names = (data.dimensions ?? []).map((d) => d.name.toLowerCase());
      const ok = ['aggregate', 'geography', 'time'].every((n) => names.includes(n));
      return { ok: !res.isError && ok, detail: `dimensions: ${names.join(', ')}` };
    });

    // 6. get_observation cpih01 {time:*, geography:K02000001, aggregate:CP00} -> >= 1 observation
    await step('get_observation cpih01 (fully specified) returns >= 1 observation', async () => {
      const res = await client.callTool({
        name: 'get_observation',
        arguments: { dataset_id: 'cpih01', dimensions: { time: '*', geography: 'K02000001', aggregate: 'CP00' } },
      });
      const data = jsonOf(res);
      const n = data.observations?.length ?? 0;
      return { ok: !res.isError && n >= 1, detail: `returned=${n}, total=${data.total_observations}` };
    });

    // 7. get_observation cpih01 missing aggregate -> isError mentioning aggregate + an option code
    await step('get_observation missing dimension errors with aggregate options', async () => {
      const res = await client.callTool({
        name: 'get_observation',
        arguments: { dataset_id: 'cpih01', dimensions: { time: '*', geography: 'K02000001' } },
      });
      const msg = textOf(res);
      const mentionsAggregate = /aggregate/i.test(msg);
      const listsOption = /e\.g\.\s+\S+/.test(msg);
      return {
        ok: res.isError === true && mentionsAggregate && listsOption,
        detail: `isError=${res.isError}, mentionsAggregate=${mentionsAggregate}, listsOption=${listsOption}`,
      };
    });

    // 8. get_latest_data cpih01 -> either data or an isError mentioning aggregate options
    await step('get_latest_data cpih01 returns data OR aggregate-options error', async () => {
      const res = await client.callTool({ name: 'get_latest_data', arguments: { dataset_id: 'cpih01' } });
      if (res.isError) {
        const msg = textOf(res);
        const ok = /aggregate/i.test(msg);
        return { ok, detail: `isError branch: mentions aggregate options = ${ok}` };
      }
      const data = jsonOf(res);
      const n = data.observations?.length ?? 0;
      return { ok: n >= 1, detail: `data branch: observations=${n}, total=${data.total_observations}` };
    });

    // 9. resources/read ons://popular_datasets parses as JSON
    await step('resource ons://popular_datasets reads as JSON', async () => {
      const res = await client.readResource({ uri: 'ons://popular_datasets' });
      const block = (res.contents ?? []).find((c) => typeof c.text === 'string');
      const parsed = JSON.parse(block.text);
      const n = parsed.popular_datasets?.length ?? 0;
      return { ok: n >= 1, detail: `popular_datasets entries=${n}` };
    });
  } finally {
    await client.close();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exitCode = 1;
});
