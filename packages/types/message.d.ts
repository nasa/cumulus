export type CumulusMeta = {
  execution_name: string
  queueName?: string
  state_machine: string
  parentExecutionArn?: string
  asyncOperationId?: string
};

export type ReplaceConfig = {
  Bucket: string
  Key: string
  TargetPath?: string
};

export type CumulusMessage = {
  cumulus_meta: CumulusMeta
  meta: object
  payload: unknown
  exception?: unknown
};

export type CumulusRemoteMessage = {
  cumulus_meta: CumulusMeta
  meta?: object
  payload?: unknown
  exception?: unknown
  replace: ReplaceConfig
};
