export interface MigrationResult {
  total_dynamo_db_records: number,
  skipped: number,
  migrated: number,
  failed: number,
}

export interface DataMigration1 {
  collections: MigrationResult,
  providers: MigrationResult,
  async_operations: MigrationResult,
  rules: MigrationResult,
}

export interface DataMigration2 {
  executions: MigrationResult,
  granules: MigrationResult,
  files: MigrationResult,
  pdrs: MigrationResult,
}

export interface MigrationSummary {
  MigrationSummary: DataMigration1 | DataMigration2
}
