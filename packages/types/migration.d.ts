export interface MigrationResult {
  total_dynamo_db_records: number,
  skipped: number,
  migrated: number,
  failed: number,
}

export interface DataMigration1Summary {
  collections: MigrationResult,
  providers: MigrationResult,
  async_operations: MigrationResult,
  rules: MigrationResult,
}

export interface GranuleDynamoDbSearchParams {
  collectionId?: string
  granuleId?: string
}

export interface GranulesMigrationResult extends MigrationResult {
  filters?: GranuleDynamoDbSearchParams
}

export interface DataMigration2Summary {
  executions?: MigrationResult,
  granules?: GranulesMigrationResult,
  files?: MigrationResult,
  pdrs?: MigrationResult,
}

export interface MigrationSummary {
  MigrationSummary: DataMigration1Summary | DataMigration2Summary
}

export interface DynamoDbParallelScanParams {
  parallelScanSegments?: number
  parallelScanLimit?: number
  writeConcurrency?: number
}

export interface MigrationLoggingParams {
  loggingInterval?: number
}

export type ParallelScanMigrationParams = MigrationLoggingParams & DynamoDbParallelScanParams;

export type GranuleMigrationParams = ParallelScanMigrationParams &
GranuleDynamoDbSearchParams & { migrateAndOverwrite?: string, migrateOnlyFiles?: string };

type DataMigration2AllowedMigrations = 'granules' | 'executions' | 'pdrs';

export interface DataMigration2HandlerEvent {
  env?: NodeJS.ProcessEnv
  executionMigrationParams?: ParallelScanMigrationParams
  granuleMigrationParams?: GranuleMigrationParams
  pdrMigrationParams?: ParallelScanMigrationParams
  migrationsList?: DataMigration2AllowedMigrations[]
}
