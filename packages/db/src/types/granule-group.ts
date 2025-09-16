export interface PostgresGranuleGroup {
  granule_cumulus_id: number
  group_id: number
  status: string
  created_at?: Date
  updated_at?: Date
}

export interface PostgresGranuleGroupRecord extends PostgresGranuleGroup {
  cumulus_id: number
  created_at: Date
  updated_at: Date
}
