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

type DataMigration2AllowedMigrations = 'granules' | 'executions' | 'pdrs';

export interface DataMigration2HandlerEvent {
  env?: NodeJS.ProcessEnv
  granuleSearchParams?: GranuleDynamoSearchParams
  migrationsList?: DataMigration2AllowedMigrations[]
}
