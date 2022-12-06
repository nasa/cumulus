export type ExecutionRecordStatus = 'completed' | 'failed' | 'running' | 'unknown';

export type ExecutionProcessingTimes = {
  processingStartDateTime: string
  processingEndDateTime: string
};

export interface ExecutionRecord {
  arn: string,
  createdAt: number,
  name: string
  status: ExecutionRecordStatus,
  asyncOperationId?: string,
  collectionId?: string,
  duration?: number,
  error?: object,
  execution?: string,
  finalPayload?: object,
  originalPayload?: object,
  parentArn?: string,
  tasks?: object,
  timestamp?: number,
  type?: string,
  updatedAt: number,
  cumulusVersion?: string,
}

export interface Execution {
  arn: string,
  createdAt: number,
  name: string
  status: ExecutionRecordStatus,
  asyncOperationId?: string | null,
  collectionId?: string | null,
  duration?: number | null,
  error?: object | null,
  execution?: string | null,
  finalPayload?: object | null,
  originalPayload?: object | null,
  parentArn?: string | null,
  tasks?: object | null,
  timestamp?: number | null,
  type?: string | null,
  updatedAt: number,
  cumulusVersion?: string | null,
}
