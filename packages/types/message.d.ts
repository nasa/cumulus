type CumulusException = 'None' | object;

export interface CumulusMeta {
  execution_name: string
  queueName?: string
  state_machine: string
  parentExecutionArn?: string
  asyncOperationId?: string
}

export interface ReplaceConfig {
  Bucket: string
  Key: string
  TargetPath?: string
}

export interface CumulusMessage {
  cumulus_meta: CumulusMeta
  meta: object
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
