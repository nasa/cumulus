export interface PostgresFile {
  granule_cumulus_id: number
  bucket?: string
  checksum_type?: string
  checksum_value?: string
  file_name?: string
  key?: string
  name?: string
  path?: string
  file_size?: number
  source?: string
}

export interface PostgresFileRecord extends PostgresFile {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date
}
