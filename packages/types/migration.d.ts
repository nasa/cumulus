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

export interface DataMigration2Summary {
  executions?: MigrationResult,
  granules?: MigrationResult,
  files?: MigrationResult,
  pdrs?: MigrationResult,
}

export interface MigrationSummary {
  MigrationSummary: DataMigration1Summary | DataMigration2Summary
}

export interface GranuleMigrationParams {
  collectionId?: string
  granuleId?: string
  parallelScanSegments?: number
  parallelScanLimit?: number
}

export interface ExecutionMigrationParams {
  parallelScanSegments?: number
  parallelScanLimit?: number
}

type DataMigration2AllowedMigrations = 'granules' | 'executions' | 'pdrs';

export interface DataMigration2HandlerEvent {
  env?: NodeJS.ProcessEnv
  executionMigrationParams?: ExecutionMigrationParams
  granuleMigrationParams?: GranuleMigrationParams
  migrationsList?: DataMigration2AllowedMigrations[]
}
