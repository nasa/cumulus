export interface CumulusMeta {
  execution_name: string
  queueName?: string
  state_machine: string
  parentExecutionArn?: string
  asyncOperationId?: string
}

export interface Meta {
  workflow_name: string
  collection?: object
  provider?: object
}

export interface CumulusMessage {
  cumulus_meta: CumulusMeta
  meta: Meta
  payload: object
  replace?: CMAReplaceConfig
}

interface CMAReplaceConfig {
  Bucket: string
  Key: string
  TargetPath?: string
}

interface CMAInnerEvent {
  event?: CumulusMessage
}

export interface CMAEventMessage {
  replace?: CMAReplaceConfig
  cma?: CMAInnerEvent
  event?: CumulusMessage
}
