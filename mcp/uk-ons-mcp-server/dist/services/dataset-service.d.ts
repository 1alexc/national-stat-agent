import { ONSApiClient, ONSDataset, ONSDatasetList, ONSObservation } from '../api/ons-client.js';
/**
 * Thrown when an observation query is missing one or more required dimensions.
 * The message enumerates each missing dimension with sample option codes so the
 * calling model can self-correct. Callers surface `.message` verbatim.
 */
export declare class MissingDimensionsError extends Error {
    constructor(message: string);
}
export interface DatasetListOptions {
    limit: number;
    offset: number;
}
interface CappedObservations {
    total_observations: number;
    returned_observations: number;
    observations: ONSObservation[];
    truncated?: boolean;
    note?: string;
}
export interface ObservationResult extends CappedObservations {
    dataset_id: string;
    edition: string;
    version: string;
    filters_applied: Record<string, string>;
    unit_of_measure?: string;
}
export interface LatestDataResult extends CappedObservations {
    dataset_id: string;
    dataset_title: string;
    edition: string;
    version: string;
    filters_applied: {
        geography: string | null;
        time_period: string | null;
    };
    dimensions_used: Record<string, string>;
    unit_of_measure?: string;
}
export interface DimensionSummary {
    name: string;
    label?: string;
    total_options: number;
    sample_options: Array<{
        option: string;
        label?: string;
    }>;
    options_error?: string;
}
export interface DatasetDimensionsResult {
    dataset_id: string;
    dataset_title: string;
    edition: string;
    version: string;
    dimensions: DimensionSummary[];
}
export interface DimensionOptionsResult {
    dataset_id: string;
    edition: string;
    version: string;
    dimension: string;
    total_options: number;
    count: number;
    offset: number;
    limit: number;
    has_more: boolean;
    next_offset?: number;
    options: Array<{
        option: string;
        label?: string;
    }>;
}
export declare class ONSDatasetService {
    private readonly client;
    constructor(client: ONSApiClient);
    listDatasets(options: DatasetListOptions): Promise<ONSDatasetList>;
    getDataset(datasetId: string): Promise<ONSDataset>;
    searchDatasets(query: string, limit: number): Promise<ONSDatasetList>;
    /**
     * Resolve a concrete edition + numeric version. The ONS API rejects the
     * literal version "latest" (HTTP 500), so any undefined/"latest" request is
     * resolved to a numeric version via the dataset/edition latest_version href.
     */
    private resolveEditionVersion;
    private getVersionDimensionNames;
    private capObservations;
    private summarize;
    /**
     * Build a MissingDimensionsError whose message lists each missing dimension
     * with up to 10 sample option codes and the total option count.
     */
    private buildMissingDimensionsError;
    /**
     * Resolve every dimension of the version to a value. `seed` holds the values
     * already chosen (e.g. time/geography). Any remaining dimension with exactly
     * one option is auto-filled; otherwise a MissingDimensionsError is thrown.
     */
    private fillDimensions;
    /** Map a case-insensitive dimension name to its canonical form for this version. */
    private buildDimensionLookup;
    getObservations(datasetId: string, edition: string | undefined, version: string | undefined, dimensions: Record<string, string>): Promise<ObservationResult>;
    getLatestData(datasetId: string, geography?: string, timePeriod?: string): Promise<LatestDataResult>;
    getDatasetDimensions(datasetId: string, edition?: string): Promise<DatasetDimensionsResult>;
    getDimensionOptions(datasetId: string, dimension: string, edition: string | undefined, limit: number, offset: number): Promise<DimensionOptionsResult>;
}
export {};
//# sourceMappingURL=dataset-service.d.ts.map