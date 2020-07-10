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
}

export interface MessageTemplate {
  cumulus_meta: object
  meta: object
}

export interface Workflow {
  arn: string
  name: string
}
