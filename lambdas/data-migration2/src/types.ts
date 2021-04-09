export interface GranuleDynamoSearchParams {
  collectionId?: string
  granuleId?: string
}

export interface MigrationSummary {
  dynamoRecords: number
  success: number
  skipped: number
  failed: number
}
