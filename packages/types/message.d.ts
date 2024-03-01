type CumulusException = 'None' | object;

export type WorkflowStatus = 'completed' | 'failed' | 'running';

export interface QueueExecutionLimits {
  [queueUrl: string]: number
}

export interface CumulusMeta {
  execution_name: string
  state_machine: string
  parentExecutionArn?: string
  asyncOperationId?: string
  queueExecutionLimits: QueueExecutionLimits
  cumulus_version?: string
}

export interface ReplaceConfig {
  Bucket: string
  Key: string
  TargetPath?: string
}

export interface Meta {
  workflow_name: string
  collection?: {
    name?: string
    version?: string
  }
  [key: string]: unknown
}

export interface CumulusMessage {
  cumulus_meta: CumulusMeta
  meta: Meta
  payload: unknown
  exception?: CumulusException
}

export interface CumulusRemoteMessage {
  cumulus_meta: CumulusMeta
  meta?: object
  payload?: unknown
  exception?: CumulusException
  replace: ReplaceConfig
}

export interface CMAMessage {
  cma?: {
    event?: object
  }
  replace?: ReplaceConfig
}
