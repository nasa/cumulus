export interface PostgresGranule {
  granule_id: string,
  status: string,
  collection_cumulus_id: number,
  cmr_link?: string,
  error?: object,
  published?: boolean,
  duration?: number,
  product_volume?: number,
  time_to_process?: number,
  time_to_archive?: number,
  provider_cumulus_id?: number,
  pdr_cumulus_id?: number,
  created_at?: Date,
  updated_at?: Date,
  timestamp?: Date,
  // Temporal info from CMR
  beginning_date_time?: Date,
  ending_date_time?: Date,
  production_date_time?: Date,
  last_update_date_time?: Date,
  // Processing info from execution
  processing_start_date_time?: Date,
  processing_end_date_time?: Date,
  query_fields?: unknown
}

export interface PostgresGranuleRecord extends PostgresGranule {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date
}
