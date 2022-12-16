export type ExecutionRecordStatus = 'completed' | 'failed' | 'running' | 'unknown';

export type ExecutionProcessingTimes = {
  processingStartDateTime: string
  processingEndDateTime: string
};

export interface ApiExecutionRecord {
  arn: string,
  createdAt: number,
  name: string,
  status: ExecutionRecordStatus,
  updatedAt: number,
  asyncOperationId?: string,
  collectionId?: string,
  cumulusVersion?: string,
  duration?: number,
  error?: object,
  execution?: string,
  finalPayload?: object,
  originalPayload?: object,
  parentArn?: string,
  tasks?: object,
  timestamp?: number,
  type?: string,
}

export interface ApiExecution {
  arn: string,
  name: string,
  asyncOperationId?: string | null,
  collectionId?: string | null,
  createdAt?: number | null,
  cumulusVersion?: string | null,
  duration?: number | null,
  error?: object | null,
  execution?: string | null,
  finalPayload?: object | null,
  originalPayload?: object | null,
  parentArn?: string | null,
  tasks?: object | null,
  timestamp?: number | null,
  type?: string | null,
  status?: ExecutionRecordStatus,
  updatedAt?: number | null,
}
