#!/usr/bin/env node
/**
 * Demo: 10 sample queries against the UK ONS MCP server over stdio.
 * Prints a compact summary of each result. Run after `npm run build`:
 *   node test/samples.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const textOf = (r) => (r.content ?? []).find((c) => c.type === 'text')?.text ?? '';
const jsonOf = (r) => JSON.parse(textOf(r));
const trim = (s, n = 500) => (s.length > n ? `${s.slice(0, n)} ...[trimmed]` : s);

let n = 0;
function heading(title, args) {
  n += 1;
  console.log(`\n#${n} ${title}`);
  console.log(`   args: ${JSON.stringify(args)}`);
}

// cpih01 time ids look like "Oct-22"; parse to a sortable date.
function parseTimeId(id) {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(id ?? '');
  if (!m) return null;
  const t = Date.parse(`01 ${m[1]} ${Number(m[2]) >= 80 ? '19' : '20'}${m[2]}`);
  return Number.isNaN(t) ? null : t;
}

function obsTimeId(obs) {
  const key = Object.keys(obs.dimensions ?? {}).find((k) => k.toLowerCase() === 'time');
  return key ? obs.dimensions[key]?.id ?? '' : '';
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: 'ignore',
  });
  const client = new Client({ name: 'uk-ons-samples', version: '1.0.0' });
  await client.connect(transport);

  const call = (name, args) => client.callTool({ name, arguments: args });

  try {
    // 1. Browse the catalogue
    let args = { limit: 3 };
    heading('list_datasets — peek at the catalogue', args);
    let res = await call('list_datasets', args);
    let data = jsonOf(res);
    console.log(`   total datasets: ${data.total}`);
    for (const d of data.datasets) console.log(`   - ${d.id}: ${d.title}`);

    // 2. Search by keyword
    args = { query: 'inflation', limit: 5 };
    heading('search_datasets — find inflation data', args);
    res = await call('search_datasets', args);
    data = jsonOf(res);
    console.log(`   matches: ${data.total_matches}`);
    for (const d of data.datasets) console.log(`   - ${d.id}: ${d.title}`);

    // 3. Dataset metadata
    args = { dataset_id: 'cpih01' };
    heading('get_dataset — cpih01 metadata', args);
    res = await call('get_dataset', args);
    data = jsonOf(res);
    console.log(`   title: ${data.title}`);
    console.log(`   description: ${trim(data.description ?? '', 180)}`);
    console.log(`   release_frequency: ${data.release_frequency}, next_release: ${data.next_release}`);

    // 4. Discover required dimensions
    args = { dataset_id: 'cpih01' };
    heading('get_dataset_dimensions — what cpih01 needs', args);
    res = await call('get_dataset_dimensions', args);
    data = jsonOf(res);
    console.log(`   edition "${data.edition}", version ${data.version}`);
    for (const dim of data.dimensions) {
      const sample = dim.sample_options.slice(0, 3).map((o) => o.option).join(', ');
      console.log(`   - ${dim.name}: ${dim.total_options} options (e.g. ${sample})`);
    }

    // 5. Page through option codes
    args = { dataset_id: 'cpih01', dimension: 'aggregate', limit: 5 };
    heading('get_dimension_options — CPIH categories', args);
    res = await call('get_dimension_options', args);
    data = jsonOf(res);
    console.log(`   total options: ${data.total_options} (showing ${data.count})`);
    for (const o of data.options) console.log(`   - ${o.option}: ${o.label}`);

    // 6. Full time series: CPIH overall index for the UK
    args = { dataset_id: 'cpih01', dimensions: { time: '*', geography: 'K02000001', aggregate: 'CP00' } };
    heading('get_observation — CPIH Overall Index, all months, UK', args);
    res = await call('get_observation', args);
    data = jsonOf(res);
    console.log(`   observations: ${data.total_observations} (unit: ${data.unit_of_measure ?? 'index'})`);
    const dated = data.observations
      .map((o) => ({ id: obsTimeId(o), t: parseTimeId(obsTimeId(o)), value: o.observation }))
      .filter((o) => o.t !== null)
      .sort((a, b) => a.t - b.t);
    const recent = dated.slice(-3);
    for (const o of recent) console.log(`   - ${o.id}: ${o.value}`);
    const latest = dated[dated.length - 1];

    // 7. Targeted query: just the latest month
    args = {
      dataset_id: 'cpih01',
      dimensions: { time: latest?.id ?? 'Oct-25', geography: 'K02000001', aggregate: 'CP00' },
    };
    heading('get_observation — single month (latest CPIH figure)', args);
    res = await call('get_observation', args);
    data = jsonOf(res);
    const single = data.observations?.[0];
    console.log(`   CPIH Overall Index, UK, ${args.dimensions.time}: ${single?.observation ?? '(none)'}`);

    // 8. Self-correcting error: omit a required dimension
    args = { dataset_id: 'cpih01', dimensions: { time: '*', geography: 'K02000001' } };
    heading('get_observation — missing "aggregate" (error guidance demo)', args);
    res = await call('get_observation', args);
    console.log(`   isError: ${res.isError}`);
    console.log(trim(textOf(res), 450).split('\n').map((l) => `   | ${l}`).join('\n'));

    // 9 & 10. Convenience wrapper on two other datasets
    for (const dataset_id of ['uk-spending-on-cards', 'weekly-deaths-region']) {
      args = { dataset_id };
      heading(`get_latest_data — ${dataset_id}`, args);
      res = await call('get_latest_data', args);
      if (res.isError) {
        console.log('   needs a choice — server returned the options:');
        console.log(trim(textOf(res), 400).split('\n').map((l) => `   | ${l}`).join('\n'));
      } else {
        data = jsonOf(res);
        console.log(`   ${data.dataset_title}`);
        console.log(`   dimensions_used: ${JSON.stringify(data.dimensions_used)}`);
        console.log(`   observations: ${data.total_observations}${data.truncated ? ` (showing ${data.returned_observations})` : ''}`);
        for (const o of data.observations.slice(-3)) {
          const dims = Object.entries(o.dimensions ?? {})
            .map(([k, v]) => `${k}=${v?.id ?? ''}`)
            .join(' ');
          console.log(`   - ${dims}: ${o.observation}`);
        }
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Sample run crashed:', err);
  process.exitCode = 1;
});
