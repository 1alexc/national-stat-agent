const MAX_OBSERVATIONS = 500;
const UK_GEOGRAPHY = 'K02000001';
const SAMPLE_OPTION_LIMIT = 10;
const DIMENSION_SAMPLE_LIMIT = 20;
const SINGLE_OPTION_PROBE_LIMIT = 2;
/**
 * Thrown when an observation query is missing one or more required dimensions.
 * The message enumerates each missing dimension with sample option codes so the
 * calling model can self-correct. Callers surface `.message` verbatim.
 */
export class MissingDimensionsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MissingDimensionsError';
    }
}
export class ONSDatasetService {
    client;
    constructor(client) {
        this.client = client;
    }
    async listDatasets(options) {
        return this.client.listDatasets(options.limit, options.offset);
    }
    async getDataset(datasetId) {
        return this.client.getDataset(datasetId);
    }
    async searchDatasets(query, limit) {
        return this.client.searchDatasets(query, limit);
    }
    /**
     * Resolve a concrete edition + numeric version. The ONS API rejects the
     * literal version "latest" (HTTP 500), so any undefined/"latest" request is
     * resolved to a numeric version via the dataset/edition latest_version href.
     */
    async resolveEditionVersion(datasetId, edition, version) {
        const wantsLatest = version === undefined || version === '' || version.toLowerCase() === 'latest';
        if (wantsLatest) {
            return this.client.resolveLatestVersion(datasetId, edition);
        }
        if (edition) {
            return { edition, version };
        }
        // Explicit version but no edition: take the default edition from the dataset.
        const resolved = await this.client.resolveLatestVersion(datasetId);
        return { edition: resolved.edition, version };
    }
    async getVersionDimensionNames(resolved, datasetId) {
        const dims = await this.client.getVersionDimensions(datasetId, resolved.edition, resolved.version);
        return dims.items.map((d) => d.name);
    }
    capObservations(all, total) {
        if (all.length > MAX_OBSERVATIONS) {
            const observations = all.slice(0, MAX_OBSERVATIONS);
            return {
                total_observations: total,
                returned_observations: observations.length,
                observations,
                truncated: true,
                note: `Showing the first ${MAX_OBSERVATIONS} of ${total} observations. Narrow the query (replace "*" with specific option codes) to target fewer values.`,
            };
        }
        return { total_observations: total, returned_observations: all.length, observations: all };
    }
    summarize(raw) {
        const all = raw.observations ?? [];
        const total = raw.total_observations ?? all.length;
        return this.capObservations(all, total);
    }
    /**
     * Build a MissingDimensionsError whose message lists each missing dimension
     * with up to 10 sample option codes and the total option count.
     */
    async buildMissingDimensionsError(datasetId, resolved, missing, allDimensions) {
        const lines = [];
        for (const dim of missing) {
            try {
                const opts = await this.client.getDimensionOptions(datasetId, resolved.edition, resolved.version, dim, SAMPLE_OPTION_LIMIT, 0);
                const total = opts.total_count ?? opts.items.length;
                const samples = opts.items
                    .slice(0, SAMPLE_OPTION_LIMIT)
                    .map((o) => (o.label ? `${o.option} (${o.label})` : o.option));
                const preview = samples.length ? `, e.g. ${samples.join('; ')}` : '';
                lines.push(`  - ${dim}: ${total} option(s)${preview}`);
            }
            catch (err) {
                lines.push(`  - ${dim}: (could not fetch options: ${err instanceof Error ? err.message : String(err)})`);
            }
        }
        const message = [
            `Missing required dimension(s) for dataset "${datasetId}" (edition "${resolved.edition}", version ${resolved.version}). Every dimension of the dataset must be given a value.`,
            ...lines,
            `All dimensions for this version: [${allDimensions.join(', ')}].`,
            `Exactly one dimension may use "*" to return all of its values; supply an explicit option code for each of the others.`,
            `Use get_dimension_options to page through the full list of codes for any dimension.`,
        ].join('\n');
        return new MissingDimensionsError(message);
    }
    /**
     * Resolve every dimension of the version to a value. `seed` holds the values
     * already chosen (e.g. time/geography). Any remaining dimension with exactly
     * one option is auto-filled; otherwise a MissingDimensionsError is thrown.
     */
    async fillDimensions(datasetId, resolved, versionDims, seed) {
        const filters = { ...seed };
        const missing = [];
        for (const name of versionDims) {
            if (name in filters)
                continue;
            const opts = await this.client.getDimensionOptions(datasetId, resolved.edition, resolved.version, name, SINGLE_OPTION_PROBE_LIMIT, 0);
            const total = opts.total_count ?? opts.items.length;
            if (total === 1 && opts.items[0]) {
                filters[name] = opts.items[0].option;
            }
            else {
                missing.push(name);
            }
        }
        if (missing.length) {
            throw await this.buildMissingDimensionsError(datasetId, resolved, missing, versionDims);
        }
        return filters;
    }
    /** Map a case-insensitive dimension name to its canonical form for this version. */
    buildDimensionLookup(versionDims) {
        return new Map(versionDims.map((name) => [name.toLowerCase(), name]));
    }
    async getObservations(datasetId, edition, version, dimensions) {
        const resolved = await this.resolveEditionVersion(datasetId, edition, version);
        const versionDims = await this.getVersionDimensionNames(resolved, datasetId);
        const lookup = this.buildDimensionLookup(versionDims);
        const provided = {};
        const unknown = [];
        for (const [key, value] of Object.entries(dimensions)) {
            const canonical = lookup.get(key.toLowerCase());
            if (!canonical) {
                unknown.push(key);
                continue;
            }
            provided[canonical] = value;
        }
        if (unknown.length) {
            throw new Error(`Unknown dimension(s) [${unknown.join(', ')}] for dataset "${datasetId}". Valid dimensions for edition "${resolved.edition}" version ${resolved.version}: [${versionDims.join(', ')}]. Call get_dataset_dimensions first.`);
        }
        const wildcards = Object.entries(provided).filter(([, v]) => v === '*').map(([k]) => k);
        if (wildcards.length > 1) {
            throw new Error(`Only one dimension may use the "*" wildcard, but ${wildcards.length} were given: [${wildcards.join(', ')}]. Choose a single dimension to vary and give explicit option codes for the rest.`);
        }
        const missing = versionDims.filter((name) => !(name in provided));
        if (missing.length) {
            throw await this.buildMissingDimensionsError(datasetId, resolved, missing, versionDims);
        }
        const raw = await this.client.getObservations(datasetId, resolved.edition, resolved.version, provided);
        return {
            dataset_id: datasetId,
            edition: resolved.edition,
            version: resolved.version,
            filters_applied: provided,
            unit_of_measure: raw.unit_of_measure,
            ...this.summarize(raw),
        };
    }
    async getLatestData(datasetId, geography, timePeriod) {
        const resolved = await this.resolveEditionVersion(datasetId, undefined, undefined);
        const [dataset, versionDims] = await Promise.all([
            this.client.getDataset(datasetId),
            this.getVersionDimensionNames(resolved, datasetId),
        ]);
        const lookup = this.buildDimensionLookup(versionDims);
        const seed = {};
        const timeDim = lookup.get('time');
        if (timeDim)
            seed[timeDim] = timePeriod ?? '*';
        const geoDim = lookup.get('geography');
        if (geoDim)
            seed[geoDim] = geography ?? UK_GEOGRAPHY;
        const filters = await this.fillDimensions(datasetId, resolved, versionDims, seed);
        const raw = await this.client.getObservations(datasetId, resolved.edition, resolved.version, filters);
        return {
            dataset_id: datasetId,
            dataset_title: dataset.title,
            edition: resolved.edition,
            version: resolved.version,
            filters_applied: { geography: geography ?? null, time_period: timePeriod ?? null },
            dimensions_used: filters,
            unit_of_measure: raw.unit_of_measure,
            ...this.summarize(raw),
        };
    }
    async getDatasetDimensions(datasetId, edition) {
        const resolved = await this.resolveEditionVersion(datasetId, edition, undefined);
        const [dataset, dimResp] = await Promise.all([
            this.client.getDataset(datasetId),
            this.client.getVersionDimensions(datasetId, resolved.edition, resolved.version),
        ]);
        const dimensions = await Promise.all(dimResp.items.map(async (dim) => {
            try {
                const opts = await this.client.getDimensionOptions(datasetId, resolved.edition, resolved.version, dim.name, DIMENSION_SAMPLE_LIMIT, 0);
                return {
                    name: dim.name,
                    label: dim.label,
                    total_options: opts.total_count ?? opts.items.length,
                    sample_options: opts.items
                        .slice(0, DIMENSION_SAMPLE_LIMIT)
                        .map((o) => ({ option: o.option, label: o.label })),
                };
            }
            catch (err) {
                return {
                    name: dim.name,
                    label: dim.label,
                    total_options: 0,
                    sample_options: [],
                    options_error: err instanceof Error ? err.message : String(err),
                };
            }
        }));
        return {
            dataset_id: datasetId,
            dataset_title: dataset.title,
            edition: resolved.edition,
            version: resolved.version,
            dimensions,
        };
    }
    async getDimensionOptions(datasetId, dimension, edition, limit, offset) {
        const resolved = await this.resolveEditionVersion(datasetId, edition, undefined);
        const opts = await this.client.getDimensionOptions(datasetId, resolved.edition, resolved.version, dimension, limit, offset);
        const total = opts.total_count ?? opts.items.length;
        const hasMore = total > offset + opts.items.length;
        return {
            dataset_id: datasetId,
            edition: resolved.edition,
            version: resolved.version,
            dimension,
            total_options: total,
            count: opts.items.length,
            offset,
            limit,
            has_more: hasMore,
            next_offset: hasMore ? offset + opts.items.length : undefined,
            options: opts.items.map((o) => ({ option: o.option, label: o.label })),
        };
    }
}
//# sourceMappingURL=dataset-service.js.map