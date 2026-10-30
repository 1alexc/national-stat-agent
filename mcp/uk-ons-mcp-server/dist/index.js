#!/usr/bin/env node
/**
 * MCP stdio server for the UK Office for National Statistics (ONS) CMD API.
 * Exposes seven read-only tools and two resources. No authentication required.
 *
 * Recommended agent workflow:
 *   search_datasets -> get_dataset_dimensions -> get_observation
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ONSApiClient } from './api/ons-client.js';
import { ONSDatasetService } from './services/dataset-service.js';
const client = new ONSApiClient();
const service = new ONSDatasetService(client);
const SERVER_NAME = 'uk_ons_mcp_server';
const SERVER_VERSION = '1.1.0';
// All tools only read from the ONS API, which is an external open-world service.
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };
// Curated dataset ids, each verified to exist in the live /datasets catalogue.
const POPULAR_DATASETS = [
    { id: 'cpih01', title: "Consumer Prices Index including owner occupiers' housing costs (CPIH)" },
    { id: 'regional-gdp-by-year', title: 'Annual GDP for England, Wales and the English regions' },
    { id: 'wellbeing-local-authority', title: 'Personal well-being estimates by local authority' },
    { id: 'uk-spending-on-cards', title: 'UK spending on credit and debit cards' },
    { id: 'weekly-deaths-region', title: 'Deaths registered weekly in England and Wales by region' },
    { id: 'trade', title: 'Trade in goods: country by commodity' },
    { id: 'ageing-population-estimates', title: 'Local authority ageing statistics (mid-year population estimates)' },
    { id: 'wellbeing-quarterly', title: 'Quarterly personal well-being estimates' },
    { id: 'traffic-camera-activity', title: 'Traffic Camera Activity' },
    { id: 'tax-benefits-statistics', title: 'Effects of Taxes and Benefits on Household Income' },
];
function jsonResult(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
/**
 * Convert any thrown error into a non-throwing tool error result so the calling
 * model can read the message and self-correct. MissingDimensionsError messages
 * pass through verbatim.
 */
function errorResult(error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text', text: message }] };
}
/** Compact dataset view for list/search results to keep responses focused. */
function summarizeDataset(d) {
    return {
        id: d.id,
        title: d.title,
        description: d.description,
        keywords: d.keywords,
        release_frequency: d.release_frequency,
        latest_version: d.links?.latest_version?.href,
    };
}
const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
server.registerTool('list_datasets', {
    title: 'List ONS datasets',
    description: 'List available UK ONS datasets with basic metadata (id, title, description, keywords). ' +
        'Paginated via limit/offset. Use this to browse the catalogue; use search_datasets when you have a keyword.',
    inputSchema: {
        limit: z.number().int().min(1).max(1000).default(20).describe('Maximum datasets to return (1-1000).'),
        offset: z.number().int().min(0).default(0).describe('Number of datasets to skip, for pagination.'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ limit, offset }) => {
    try {
        const res = await service.listDatasets({ limit, offset });
        const hasMore = res.total_count > offset + res.items.length;
        return jsonResult({
            total: res.total_count,
            count: res.items.length,
            offset,
            limit,
            has_more: hasMore,
            next_offset: hasMore ? offset + res.items.length : undefined,
            datasets: res.items.map(summarizeDataset),
        });
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerTool('search_datasets', {
    title: 'Search ONS datasets',
    description: 'Search the ONS dataset catalogue by keyword (case-insensitive match over id, title, description and keywords). ' +
        'Returns compact dataset summaries. This is the recommended first step to find a dataset id.',
    inputSchema: {
        query: z.string().min(1, 'query must not be empty').describe('Keyword(s) to match, e.g. "inflation" or "wellbeing".'),
        limit: z.number().int().min(1).max(100).default(10).describe('Maximum results to return (1-100).'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ query, limit }) => {
    try {
        const res = await service.searchDatasets(query, limit);
        return jsonResult({
            query,
            total_matches: res.total_count,
            count: res.items.length,
            datasets: res.items.map(summarizeDataset),
        });
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerTool('get_dataset', {
    title: 'Get ONS dataset metadata',
    description: 'Get full metadata for a single ONS dataset by id, including description, license, contacts, release frequency ' +
        'and the latest_version link. Use search_datasets or list_datasets first to find the id.',
    inputSchema: {
        dataset_id: z.string().min(1).describe('The dataset id, e.g. "cpih01".'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ dataset_id }) => {
    try {
        const dataset = await service.getDataset(dataset_id);
        return jsonResult(dataset);
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerTool('get_dataset_dimensions', {
    title: 'Get ONS dataset dimensions',
    description: 'List the dimensions of a dataset\'s latest version, each with its total option count and up to 20 sample option ' +
        'codes and labels. Call this BEFORE get_observation to learn which dimensions are required and what option codes ' +
        'to supply. Optionally target a specific edition.',
    inputSchema: {
        dataset_id: z.string().min(1).describe('The dataset id, e.g. "cpih01".'),
        edition: z.string().min(1).optional().describe('Optional edition; defaults to the dataset\'s default edition.'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ dataset_id, edition }) => {
    try {
        const result = await service.getDatasetDimensions(dataset_id, edition);
        return jsonResult(result);
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerTool('get_dimension_options', {
    title: 'Get ONS dimension options',
    description: 'Page through the full list of valid option codes (and labels) for one dimension of a dataset\'s latest version. ' +
        'Use this when get_dataset_dimensions shows more options than its sample, to find the exact code to pass to get_observation.',
    inputSchema: {
        dataset_id: z.string().min(1).describe('The dataset id, e.g. "cpih01".'),
        dimension: z.string().min(1).describe('The dimension name, e.g. "aggregate", "geography" or "time".'),
        edition: z.string().min(1).optional().describe('Optional edition; defaults to the dataset\'s default edition.'),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum options to return (1-200).'),
        offset: z.number().int().min(0).default(0).describe('Number of options to skip, for pagination.'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ dataset_id, dimension, edition, limit, offset }) => {
    try {
        const result = await service.getDimensionOptions(dataset_id, dimension, edition, limit, offset);
        return jsonResult(result);
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerTool('get_observation', {
    title: 'Get ONS observations',
    description: 'Retrieve statistical observations (data points) for a dataset. EVERY dimension of the dataset must be given a ' +
        'value in the `dimensions` map, and EXACTLY ONE dimension may use "*" to return all of its values (e.g. time="*" ' +
        'for a time series). Call get_dataset_dimensions first to learn the required dimensions and option codes. ' +
        'If a required dimension is omitted, this returns an error listing the missing dimensions and sample codes so you ' +
        'can retry. Defaults to the latest edition/version unless edition/version are given. Example dimensions for cpih01: ' +
        '{"time":"*","geography":"K02000001","aggregate":"cpih1dim1A0"}.',
    inputSchema: {
        dataset_id: z.string().min(1).describe('The dataset id, e.g. "cpih01".'),
        dimensions: z
            .record(z.string())
            .describe('Map of dimension name -> option code. Every dimension is required; exactly one may be "*".'),
        edition: z.string().min(1).optional().describe('Optional edition; defaults to the dataset\'s default edition.'),
        version: z
            .string()
            .min(1)
            .optional()
            .describe('Optional numeric version or "latest"; defaults to the latest version.'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ dataset_id, dimensions, edition, version }) => {
    try {
        const result = await service.getObservations(dataset_id, edition, version, dimensions);
        return jsonResult(result);
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerTool('get_latest_data', {
    title: 'Get latest ONS data',
    description: 'Convenience wrapper that fetches the latest observations for a dataset, auto-filling time="*" (all periods) and ' +
        'geography="K02000001" (UK) when those dimensions exist, and auto-filling any other dimension that has only one ' +
        'option. When the dataset needs additional dimensions with several options, this returns an error listing those ' +
        'dimensions and their available option codes so you can choose and call get_observation instead.',
    inputSchema: {
        dataset_id: z.string().min(1).describe('The dataset id, e.g. "cpih01".'),
        geography: z.string().min(1).optional().describe('Optional geography code; defaults to K02000001 (UK).'),
        time_period: z.string().min(1).optional().describe('Optional time code; defaults to "*" (all time periods).'),
    },
    annotations: READ_ONLY_ANNOTATIONS,
}, async ({ dataset_id, geography, time_period }) => {
    try {
        const result = await service.getLatestData(dataset_id, geography, time_period);
        return jsonResult(result);
    }
    catch (error) {
        return errorResult(error);
    }
});
server.registerResource('popular_datasets', 'ons://popular_datasets', {
    title: 'Popular ONS datasets',
    description: 'A curated list of commonly used ONS dataset ids and titles, each verified against the live catalogue.',
    mimeType: 'application/json',
}, async (uri) => ({
    contents: [
        {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ popular_datasets: POPULAR_DATASETS }, null, 2),
        },
    ],
}));
server.registerResource('api_info', 'ons://api_info', {
    title: 'ONS API information',
    description: 'Details about the ONS CMD API and the recommended agent workflow for querying observations.',
    mimeType: 'application/json',
}, async (uri) => ({
    contents: [
        {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
                api_info: {
                    base_url: 'https://api.beta.ons.gov.uk/v1',
                    authentication: 'None required',
                    rate_limits: 'Standard fair-use policy',
                    data_format: 'JSON',
                    documentation: 'https://developer.ons.gov.uk/',
                    recommended_workflow: [
                        'search_datasets (find a dataset id by keyword)',
                        'get_dataset_dimensions (learn required dimensions and option codes)',
                        'get_observation (query data; every dimension needs a value, exactly one may be "*")',
                    ],
                    notes: 'The literal version "latest" is not queryable; this server resolves a numeric version automatically.',
                },
            }, null, 2),
        },
    ],
}));
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stdout is reserved for the MCP transport; log to stderr only.
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}
main().catch((error) => {
    console.error('Fatal error starting UK ONS MCP Server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map