export type RuleType = 'kinesis' | 'onetime' | 'scheduled' | 'sns' | 'sqs';

export type RuleState = 'ENABLED' | 'DISABLED';

export interface Rule {
  type: RuleType,
  arn?: string,
  logEventArn?: string
  value?: string,
}

export interface PartialRuleRecord {
  name?: string,
  rule?: Rule,
  state?: RuleState,
  workflow?: string,
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
  queueName?: string,
  executionNamePrefix?: string,
  queueUrl?: string,
  tags?: string[],
}

export interface NewRuleRecord extends PartialRuleRecord {
  name: string,
  workflow: string,
  rule: Rule,
  state: RuleState
}

export interface RuleRecord extends NewRuleRecord {
  createdAt: number,
  updatedAt: number
}
