/**
 * DuckDB functionality for Iceberg operations.
 * This module should only be imported in services that actually need DuckDB (like ECS services).
 * Lambda functions should avoid importing this to prevent bundling native DuckDB libraries.
 */

export {
  initializeDuckDb,
  acquireDuckDbConnection,
  releaseDuckDbConnection,
  destroyDuckDb,
} from './iceberg-connection';

// Re-export S3 search classes that depend on DuckDB
export { GranuleIcebergSearch } from './iceberg-search/GranuleIcebergSearch';
export { CollectionIcebergSearch } from './iceberg-search/CollectionIcebergSearch';
export { ExecutionIcebergSearch } from './iceberg-search/ExecutionIcebergSearch';
export { ProviderIcebergSearch } from './iceberg-search/ProviderIcebergSearch';
export { RuleIcebergSearch } from './iceberg-search/RuleIcebergSearch';
export { PdrIcebergSearch } from './iceberg-search/PdrIcebergSearch';
export { AsyncOperationIcebergSearch } from './iceberg-search/AsyncOperationIcebergSearch';
export { ReconciliationReportIcebergSearch } from './iceberg-search/ReconciliationReportIcebergSearch';
export { StatsIcebergSearch } from './iceberg-search/StatsIcebergSearch';
