export type AsyncOperationStatus =
  | 'RUNNER_FAILED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'TASK_FAILED';

export type AsyncOperationType =
  | 'Bulk Execution Delete'
  | 'Bulk Granule Delete'
  | 'Bulk Granule Reingest'
  | 'Bulk Granules'
  | 'Dead-Letter Processing'
  | 'DLA Migration'
  | 'ES Index'
  | 'Kinesis Replay'
  | 'Reconciliation Report'
  | 'SQS Replay'
  | 'Bulk Granule Archive'
  | 'Bulk Execution Archive';

export interface ApiAsyncOperation {
  id: string,
  description: string,
  operationType: AsyncOperationType,
  status: AsyncOperationStatus,
  taskArn?: string,
  output?: string,
  createdAt?: number,
  updatedAt?: number,
}
