export interface PostgresRule {
  name: string,
  workflow: string,
  type: string,
  enabled: boolean,
  collection_cumulus_id?: number,
  provider_cumulus_id?: number,
  execution_name_prefix?: string,
  value?: string,
  arn?: string,
  log_event_arn?: string,
  payload?: object,
  meta?: string,
  tags?: string,
  queue_url?: string,
  created_at: Date,
  updated_at: Date,
}

export interface PostgresRuleRecord extends PostgresRule {
  cumulus_id: number,
}
