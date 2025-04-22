export type GranuleStatus = 'completed' | 'failed' | 'running' | 'queued';
export interface PostgresGranuleUniqueColumns {
  granule_id: string,
  collection_cumulus_id: number,
}
export interface PostgresGranule extends PostgresGranuleUniqueColumns {
  producer_granule_id?: string,
  status?: GranuleStatus,
  cmr_link?: string | null,
  error?: object | null,
  published?: boolean | null,
  duration?: number | null,
  product_volume?: string | null,
  time_to_process?: number | null,
  time_to_archive?: number | null,
  provider_cumulus_id?: number | null,
  pdr_cumulus_id?: number | null,
  created_at?: Date | null,
  updated_at?: Date | null,
  timestamp?: Date | null,
  // Temporal info from CMR
  beginning_date_time?: Date | null,
  ending_date_time?: Date | null,
  production_date_time?: Date | null,
  last_update_date_time?: Date | null,
  // Processing info from execution
  processing_start_date_time?: Date | null,
  processing_end_date_time?: Date | null,
  query_fields?: unknown | null,
}

// product_volume is stored as a BigInt in Postgres. It returns from PG to Node
// as a "string" type.
export interface PostgresGranuleRecord extends Omit<PostgresGranule, 'product_volume'> {
  cumulus_id: number,
  producer_granule_id: string,
  product_volume?: string,
  created_at: Date,
  updated_at: Date,
  status: GranuleStatus,
}
