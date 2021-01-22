import { ExecutionRecordStatus } from '@cumulus/types/api/executions';

export interface PostgresExecution {
  arn: string,
  async_operation_cumulus_id?: number,
  collection_cumulus_id?: number,
  created_at?: Date,
  cumulus_version?: string,
  duration?: number,
  error?: object,
  final_payload?: object,
  original_payload?: object,
  parent_cumulus_id?: number,
  status: ExecutionRecordStatus,
  tasks?: object,
  timestamp?: Date,
  updated_at?: Date,
  url?: string,
  workflow_name?: string,
}

export interface PostgresExecutionRecord extends PostgresExecution {
  created_at: Date,
  cumulus_id: number,
  updated_at: Date,
}
