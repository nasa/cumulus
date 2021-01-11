export type ExecutionRecordStatus = 'completed' | 'failed' | 'running' | 'unknown';

export interface ExecutionRecord {
  arn: string,
  createdAt: number,
  name: string
  status: ExecutionRecordStatus,
  asyncOperationId?: string,
  collectionId?: string,
  duration?: number,
  error?: unknown,
  execution?: string,
  finalPayload?: unknown,
  originalPayload?: unknown,
  parentArn?: string,
  tasks?: unknown,
  timestamp?: number,
  type?: string,
  updatedAt: number,
  cumulusVersion?: string,
}
