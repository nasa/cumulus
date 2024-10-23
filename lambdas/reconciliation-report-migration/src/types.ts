export type MigrationResult = {
  total_dynamo_db_records: number,
  skipped: number,
  migrated: number,
  failed: number,
};

export type MigrationSummary = {
  reconciliation_reports: MigrationResult
};
