/**
 * Native-fetch client for the UK ONS CMD API (https://api.beta.ons.gov.uk/v1).
 * No authentication is required. All requests go through a single `request`
 * helper that validates identifiers, encodes every path/query segment, and
 * retries once on transient failures.
 */
const BASE_URL = 'https://api.beta.ons.gov.uk/v1';
const USER_AGENT = 'uk_ons_mcp_server/1.1.0';
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 750;
const MAX_ERROR_BODY_CHARS = 300;
// dataset ids, editions, versions and dimension names all share this charset.
const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatHttpError(status, body, path) {
    const detail = body.trim() ? ` - ${body.trim()}` : '';
    let prefix;
    if (status === 404)
        prefix = `ONS API resource not found (404) for ${path}`;
    else if (status === 400)
        prefix = `ONS API bad request (400) for ${path}`;
    else if (status === 429)
        prefix = `ONS API rate limited (429) for ${path}`;
    else if (status >= 500)
        prefix = `ONS API server error (${status}) for ${path}`;
    else
        prefix = `ONS API error (${status}) for ${path}`;
    return `${prefix}${detail}`;
}
/**
 * Parse the edition and numeric version out of a `latest_version.href` such as
 * ".../datasets/cpih01/editions/time-series/versions/67". The ONS API does not
 * accept the literal version "latest" (it returns HTTP 500), so callers must
 * resolve a numeric version this way before querying observations.
 */
export function parseVersionHref(href) {
    const match = href.match(/\/editions\/([^/]+)\/versions\/(\d+)/);
    if (!match)
        return null;
    return { edition: decodeURIComponent(match[1]), version: match[2] };
}
export class ONSApiClient {
    baseUrl = BASE_URL;
    /** Enforce the safe charset on an identifier before it reaches the network. */
    validateId(value, kind) {
        if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
            throw new Error(`Invalid ${kind} "${String(value)}": must be 1-100 characters using only letters, digits, dot, underscore or hyphen.`);
        }
        return value;
    }
    /** Dimension values may be the wildcard "*"; otherwise they share the id charset. */
    validateDimensionValue(value, dimension) {
        if (value === '*')
            return value;
        if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
            throw new Error(`Invalid value "${String(value)}" for dimension "${dimension}": must be "*" or 1-100 characters using only letters, digits, dot, underscore or hyphen.`);
        }
        return value;
    }
    /**
     * Core request helper. Builds a URL from encoded path segments plus a
     * URLSearchParams query, applies a 30s timeout, and retries once on
     * 429/5xx/network errors. Non-retryable errors (e.g. 400/404) throw
     * immediately with the ONS plain-text body preserved (it is actionable,
     * e.g. the "missing query parameters for the following dimensions" message).
     */
    async request(pathSegments, query) {
        const encodedPath = pathSegments.map((s) => encodeURIComponent(s)).join('/');
        const url = new URL(`${this.baseUrl}/${encodedPath}`);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                url.searchParams.set(key, String(value));
            }
        }
        let lastError;
        for (let attempt = 0; attempt <= 1; attempt++) {
            if (attempt > 0)
                await delay(RETRY_DELAY_MS);
            let response;
            try {
                response = await fetch(url, {
                    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
            }
            catch (err) {
                // Network failure or timeout abort -> retryable.
                lastError = new Error(`ONS API network error for ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }
            if (response.ok) {
                return (await response.json());
            }
            const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS);
            const status = response.status;
            if (status === 429 || status >= 500) {
                lastError = new Error(formatHttpError(status, body, url.pathname));
                continue; // retryable
            }
            // Non-retryable: surface immediately with the ONS message intact.
            throw new Error(formatHttpError(status, body, url.pathname));
        }
        throw lastError ?? new Error(`ONS API request failed for ${url.pathname}`);
    }
    async listDatasets(limit = 20, offset = 0) {
        return this.request(['datasets'], { limit, offset });
    }
    async getDataset(id) {
        this.validateId(id, 'dataset id');
        return this.request(['datasets', id]);
    }
    async getEdition(id, edition) {
        this.validateId(id, 'dataset id');
        this.validateId(edition, 'edition');
        return this.request(['datasets', id, 'editions', edition]);
    }
    /**
     * Resolve the default edition and numeric latest version for a dataset.
     * When `edition` is omitted, both are parsed from the dataset's
     * `latest_version` href. When `edition` is supplied, the version is parsed
     * from that edition's `latest_version` href instead.
     */
    async resolveLatestVersion(id, edition) {
        this.validateId(id, 'dataset id');
        let href;
        if (edition) {
            this.validateId(edition, 'edition');
            const ed = await this.getEdition(id, edition);
            href = ed.links?.latest_version?.href;
        }
        else {
            const ds = await this.getDataset(id);
            href = ds.links?.latest_version?.href;
        }
        if (!href) {
            throw new Error(`Could not determine the latest version for dataset "${id}"${edition ? ` edition "${edition}"` : ''}: the ONS API returned no latest_version link.`);
        }
        const parsed = parseVersionHref(href);
        if (!parsed) {
            throw new Error(`Could not parse an edition/version from the ONS latest_version href "${href}".`);
        }
        return { edition: edition ?? parsed.edition, version: parsed.version };
    }
    async getVersionDimensions(id, edition, version) {
        this.validateId(id, 'dataset id');
        this.validateId(edition, 'edition');
        this.validateId(version, 'version');
        return this.request([
            'datasets',
            id,
            'editions',
            edition,
            'versions',
            version,
            'dimensions',
        ]);
    }
    async getDimensionOptions(id, edition, version, dimension, limit = 50, offset = 0) {
        this.validateId(id, 'dataset id');
        this.validateId(edition, 'edition');
        this.validateId(version, 'version');
        this.validateId(dimension, 'dimension name');
        return this.request(['datasets', id, 'editions', edition, 'versions', version, 'dimensions', dimension, 'options'], { limit, offset });
    }
    async getObservations(id, edition, version, dimensions) {
        this.validateId(id, 'dataset id');
        this.validateId(edition, 'edition');
        this.validateId(version, 'version');
        const query = {};
        for (const [dimension, value] of Object.entries(dimensions)) {
            this.validateId(dimension, 'dimension name');
            this.validateDimensionValue(value, dimension);
            query[dimension] = value;
        }
        return this.request(['datasets', id, 'editions', edition, 'versions', version, 'observations'], query);
    }
    /**
     * The ONS API has no server-side dataset search, so fetch the catalogue and
     * filter client-side over id/title/description/keywords (case-insensitive).
     */
    async searchDatasets(query, limit = 10) {
        const all = await this.fetchAllDatasets();
        const term = query.toLowerCase();
        const matches = all.filter((d) => {
            const haystack = [d.id, d.title, d.description, ...(d.keywords ?? [])]
                .filter((v) => typeof v === 'string')
                .join(' ')
                .toLowerCase();
            return haystack.includes(term);
        });
        const items = matches.slice(0, limit);
        return { count: items.length, items, limit, offset: 0, total_count: matches.length };
    }
    async fetchAllDatasets() {
        const pageSize = 1000; // verified: /datasets?limit=1000 returns the full catalogue
        const maxPages = 3;
        const all = [];
        let offset = 0;
        for (let page = 0; page < maxPages; page++) {
            const res = await this.listDatasets(pageSize, offset);
            all.push(...res.items);
            const total = res.total_count ?? all.length;
            offset += res.items.length;
            if (res.items.length === 0 || all.length >= total)
                break;
        }
        return all;
    }
}
//# sourceMappingURL=ons-client.js.map