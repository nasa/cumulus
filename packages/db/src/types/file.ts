export interface PostgresFile {
  granule_cumulus_id: number
  bucket: string
  checksum_type?: string
  checksum_value?: string
  file_name?: string
  file_size?: number
  key: string
  path?: string
  source?: string
}

export interface PostgresFileRecord extends PostgresFile {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date
}
