export type RuleType = 'kinesis' | 'onetime' | 'scheduled' | 'sns' | 'sqs';

export type RuleRecord = {
  createdAt: number,
  name: string,
  rule: {
    type: RuleType,
    arn?: string,
    logEventArn?: string
    value?: string,
  },
  state: 'ENABLED' | 'DISABLED',
  updatedAt: number,
  workflow: string,
  collection?: {
    name: string,
    version: string
  },
  meta?: {
    retries?: number,
    visibility?: number,
    [key: string]: unknown
  },
  payload?: unknown,
  provider?: string,
  queueName?: string
};
