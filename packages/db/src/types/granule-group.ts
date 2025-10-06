export interface PostgresGranuleGroup {
  granule_cumulus_id: number
  group_id: number
  state: string
  created_at?: Date
  updated_at?: Date
}

export interface PostgresGranuleGroupRecord extends PostgresGranuleGroup {
  created_at: Date
  updated_at: Date
}
