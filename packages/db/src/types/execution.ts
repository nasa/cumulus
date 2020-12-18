export interface PostgresExecution {
  arn: string,
  status: string,
  async_operation_cumulus_id?: number,
  collection_cumulus_id?: number,
  parent_cumulus_id?: number,
  cumulus_version?: string,
  created_at?: Date,
  updated_at?: Date,
}

export interface PostgresExecutionRecord extends PostgresExecution {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date,
}
