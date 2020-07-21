import { Message } from '@cumulus/types';

export interface MessageTemplateCumulusMeta {
  queueExecutionLimits: {
    [queueUrl: string]: number
  }
}

export interface MessageTemplate {
  cumulus_meta: MessageTemplateCumulusMeta
  meta: object
}

export interface Workflow {
  arn: string
  name: string
}

export interface QueueMessageMeta {
  workflow_name: string
  collection?: object
  provider?: object
}

export interface CumulusQueueMessage {
  cumulus_meta: Message.CumulusMeta & MessageTemplateCumulusMeta
  meta: QueueMessageMeta
  payload: object
}
