export interface MigrationCountsPayload {
  reportBucket: string,
  reportPath: string,
  cutoffSeconds: number,
  dbConcurrency: number,
  dbMaxPool: number
}
