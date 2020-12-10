export type AsyncOperationStatus = 'RUNNING' | 'SUCCEEDED' | 'RUNNER_FAILED' | 'TASK_FAILED';

export type AsyncOperationType = 'ES Index' | 'Bulk Granules' | 'Bulk Granule Reingest' | 'Bulk Granule Delete' | 'Kinesis Replay' | 'Reconciliation Report';

export interface ApiAsyncOperation {
  id: string
  description: string
  operationType: AsyncOperationType
  status: AsyncOperationStatus
  taskArn?: string
  output?: string
  createdAt?: number
  updatedAt?: number
}
