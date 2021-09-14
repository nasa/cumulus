export interface PostgresFile {
  bucket?: string,
  key?: string,
  granule_cumulus_id: number
  checksum_type?: string
  checksum_value?: string
  file_name?: string
  file_size?: number
  path?: string
  source?: string,
  type?: string,
}

export interface PostgresFileRecord extends PostgresFile {
  bucket: string,
  key: string,
  cumulus_id: number,
  created_at: Date,
  updated_at: Date
}
