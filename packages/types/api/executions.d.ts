export type ExecutionRecordStatus = 'completed' | 'failed' | 'running' | 'unknown';

export type ExecutionProcessingTimes = {
  processingStartDateTime: string
  processingEndDateTime: string
};

export interface ExecutionRecord {
  arn: string,
  name: string,
  status: ExecutionRecordStatus,
  createdAt: number,
  updatedAt: number,
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
  cumulusVersion?: string,
}

export interface ApiExecution {
  arn: string,
  name: string,
  status?: ExecutionRecordStatus,
  createdAt?: number,
  updatedAt?: number,
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
  cumulusVersion?: string | null,
}
