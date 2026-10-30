/**
 * Native-fetch client for the UK ONS CMD API (https://api.beta.ons.gov.uk/v1).
 * No authentication is required. All requests go through a single `request`
 * helper that validates identifiers, encodes every path/query segment, and
 * retries once on transient failures.
 */
export interface ONSLink {
    href: string;
    id?: string;
}
export interface ONSDataset {
    id: string;
    title: string;
    description?: string;
    keywords?: string[];
    license?: string;
    release_frequency?: string;
    national_statistic?: boolean;
    last_updated?: string;
    next_release?: string;
    unit_of_measure?: string;
    contacts?: Array<{
        email?: string;
        name?: string;
        telephone?: string;
    }>;
    links?: {
        self?: ONSLink;
        editions?: ONSLink;
        latest_version?: ONSLink;
        taxonomy?: ONSLink;
        [key: string]: ONSLink | undefined;
    };
}
export interface ONSDatasetList {
    count: number;
    items: ONSDataset[];
    limit: number;
    offset: number;
    total_count: number;
}
export interface ONSEdition {
    edition?: string;
    links?: {
        latest_version?: ONSLink;
        [key: string]: ONSLink | undefined;
    };
}
export interface ONSVersionDimension {
    name: string;
    label?: string;
    description?: string;
    links?: {
        options?: ONSLink;
        code_list?: ONSLink;
        version?: ONSLink;
    };
}
export interface ONSVersionDimensionsResponse {
    items: ONSVersionDimension[];
}
export interface ONSDimensionOption {
    option: string;
    label?: string;
    dimension?: string;
    links?: Record<string, ONSLink>;
}
export interface ONSDimensionOptionsResponse {
    items: ONSDimensionOption[];
    count?: number;
    offset?: number;
    limit?: number;
    total_count?: number;
}
export interface ONSObservation {
    dimensions: Record<string, {
        href?: string;
        id?: string;
        label?: string;
    }>;
    observation: string;
}
export interface ONSObservationResponse {
    observations: ONSObservation[];
    dimensions?: Record<string, unknown>;
    links?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    total_observations: number;
    unit_of_measure?: string;
}
/** A concrete edition + numeric version resolved from a `latest_version` href. */
export interface ResolvedVersion {
    edition: string;
    version: string;
}
/**
 * Parse the edition and numeric version out of a `latest_version.href` such as
 * ".../datasets/cpih01/editions/time-series/versions/67". The ONS API does not
 * accept the literal version "latest" (it returns HTTP 500), so callers must
 * resolve a numeric version this way before querying observations.
 */
export declare function parseVersionHref(href: string): ResolvedVersion | null;
export declare class ONSApiClient {
    private readonly baseUrl;
    /** Enforce the safe charset on an identifier before it reaches the network. */
    private validateId;
    /** Dimension values may be the wildcard "*"; otherwise they share the id charset. */
    private validateDimensionValue;
    /**
     * Core request helper. Builds a URL from encoded path segments plus a
     * URLSearchParams query, applies a 30s timeout, and retries once on
     * 429/5xx/network errors. Non-retryable errors (e.g. 400/404) throw
     * immediately with the ONS plain-text body preserved (it is actionable,
     * e.g. the "missing query parameters for the following dimensions" message).
     */
    private request;
    listDatasets(limit?: number, offset?: number): Promise<ONSDatasetList>;
    getDataset(id: string): Promise<ONSDataset>;
    getEdition(id: string, edition: string): Promise<ONSEdition>;
    /**
     * Resolve the default edition and numeric latest version for a dataset.
     * When `edition` is omitted, both are parsed from the dataset's
     * `latest_version` href. When `edition` is supplied, the version is parsed
     * from that edition's `latest_version` href instead.
     */
    resolveLatestVersion(id: string, edition?: string): Promise<ResolvedVersion>;
    getVersionDimensions(id: string, edition: string, version: string): Promise<ONSVersionDimensionsResponse>;
    getDimensionOptions(id: string, edition: string, version: string, dimension: string, limit?: number, offset?: number): Promise<ONSDimensionOptionsResponse>;
    getObservations(id: string, edition: string, version: string, dimensions: Record<string, string>): Promise<ONSObservationResponse>;
    /**
     * The ONS API has no server-side dataset search, so fetch the catalogue and
     * filter client-side over id/title/description/keywords (case-insensitive).
     */
    searchDatasets(query: string, limit?: number): Promise<ONSDatasetList>;
    private fetchAllDatasets;
}
//# sourceMappingURL=ons-client.d.ts.map