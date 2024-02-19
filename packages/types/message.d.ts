type CumulusException = 'None' | object;

export type WorkflowStatus = 'completed' | 'failed' | 'running';

export interface QueueExecutionLimits {
  [queueUrl: string]: number
}

/**
 * Check for QueueExecutionLimits Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is QueueExecutionLimits}
 */
export const isQueueExecutionLimits = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && Object.keys(obj).reduce(
    (correct, key) => (correct && key instanceof string && obj[key] instanceof number),
    1
  )
);

export interface CumulusMeta {
  execution_name: string
  state_machine: string
  parentExecutionArn?: string
  asyncOperationId?: string
  queueExecutionLimits: QueueExecutionLimits
  cumulus_version?: string
}

/**
 * Check for CumulusMeta Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is CumulusMeta}
 */
export const isCumulusMeta = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'execution_name' in obj && obj.execution_name instanceof string
  && 'state_machine' in obj && obj.Key instanceof string
  && 'queueExecutionLimits' in isQueueExecutionLimit(obj.queueExecutionLimits)
);

export interface ReplaceConfig {
  Bucket: string
  Key: string
  TargetPath?: string
}

/**
 * Check for ReplaceConfig Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is ReplaceConfig}
 */
export const isReplacConfig = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'Bucket' in obj && obj.Bucket instanceof string
  && 'Key' in obj && obj.Key instanceof string
);
export interface Meta {
  workflow_name: string
  collection?: {
    name?: string
    version?: string
  }
  [key: string]: unknown
}

/**
 * Check for Meta Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is Meta}
 */
export const isMeta = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'workflow_name' in obj && obj.workflow_name instanceof string
);
export interface CumulusMessage {
  cumulus_meta: CumulusMeta
  meta: Meta
  payload: unknown
  exception?: CumulusException
}

/**
 * Check for CumulusMessage Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is CumulusMessage}
 */
export const isCumulusMessage = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'cumulus_meta' in obj && isCumulusMeta(obj.cumulus_meta)
  && 'meta' in obj && isMeta(obj.meta)
  && 'payload' in obj
);
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
