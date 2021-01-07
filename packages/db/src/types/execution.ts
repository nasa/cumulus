import { ExecutionRecordStatus } from '@cumulus/types/api/executions';

export interface PostgresExecution {
  arn: string,
  async_operation_cumulus_id?: number,
  collection_cumulus_id?: number,
  parent_cumulus_id?: number,
  cumulus_version?: string,
  url?: string,
  status?: ExecutionRecordStatus,
  tasks?: Object, // TODO need specific type?
  error?: Object, // TODO need specific type?
  workflow_name?: string,
  duration?: number,
  original_payload?: Object,
  final_payload?: Object
  timestamp?: Date,
  created_at?: Date,
  updated_at?: Date,
}

export interface PostgresExecutionRecord extends PostgresExecution {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date,
}