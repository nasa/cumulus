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

export interface GranuleDynamoDbSearchParams {
  collectionId?: string
  granuleId?: string
}

type DataMigration2AllowedMigrations = 'granules' | 'executions' | 'pdrs';

export interface DataMigration2HandlerEvent {
  env?: NodeJS.ProcessEnv
  granuleSearchParams?: GranuleDynamoDbSearchParams
  migrationsList?: DataMigration2AllowedMigrations[]
}
