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
export { GranuleS3Search } from './s3search/GranuleS3Search';
export { CollectionS3Search } from './s3search/CollectionS3Search';
export { ExecutionS3Search } from './s3search/ExecutionS3Search';
export { ProviderS3Search } from './s3search/ProviderS3Search';
export { RuleS3Search } from './s3search/RuleS3Search';
export { PdrS3Search } from './s3search/PdrS3Search';
export { AsyncOperationS3Search } from './s3search/AsyncOperationS3Search';
export { ReconciliationReportS3Search } from './s3search/ReconciliationReportS3Search';
export { StatsS3Search } from './s3search/StatsS3Search';
