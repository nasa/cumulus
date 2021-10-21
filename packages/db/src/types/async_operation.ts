import { AsyncOperationStatus, AsyncOperationType } from '@cumulus/types/api/async_operations';

export interface PostgresAsyncOperation {
  id: string,
  description: string,
  operation_type: AsyncOperationType,
  status: AsyncOperationStatus,
  output?: object,
  task_arn?: string,
  created_at?: Date,
  updated_at?: Date,
}

export interface PostgresAsyncOperationRecord extends PostgresAsyncOperation {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date,
}
