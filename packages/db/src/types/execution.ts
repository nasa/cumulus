import { ExecutionRecordStatus } from '@cumulus/types/api/executions';

export interface PostgresExecution {
  arn: string,
  async_operation_cumulus_id?: number | null,
  collection_cumulus_id?: number | null,
  created_at?: Date | null,
  cumulus_version?: string | null,
  duration?: number | null,
  error?: object | null,
  final_payload?: object | null,
  original_payload?: object | null,
  parent_cumulus_id?: string | null,
  status?: ExecutionRecordStatus,
  tasks?: object | null,
  timestamp?: Date | null,
  updated_at?: Date | null,
  url?: string | null,
  workflow_name?: string | null,
}

export interface PostgresExecutionRecord extends PostgresExecution {
  created_at: Date,
  cumulus_id: string,
  updated_at: Date,
}
