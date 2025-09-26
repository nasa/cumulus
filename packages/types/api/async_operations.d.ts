export type AsyncOperationStatus =
  | 'RUNNER_FAILED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'TASK_FAILED';

export type AsyncOperationType =
  | 'Bulk Execution Archive'
  | 'Bulk Execution Delete'
  | 'Bulk Granules'
  | 'Bulk Granule Archive'
  | 'Bulk Granule Delete'
  | 'Bulk Granule Reingest'
  | 'Data Migration'
  | 'Dead-Letter Processing'
  | 'DLA Migration'
  | 'ES Index'
  | 'Kinesis Replay'
  | 'Migration Count Report'
  | 'Reconciliation Report'
  | 'SQS Replay';

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
