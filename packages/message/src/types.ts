export type MessageTemplate = {
  cumulus_meta: object
  meta: object
}

export type Workflow = {
  arn: string
  name: string
}

export type QueueMessageMeta = {
  workflow_name: string
  collection?: object
  provider?: object
};
