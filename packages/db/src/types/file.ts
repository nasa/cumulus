export interface PostgresFile {
  bucket?: string,
  key?: string,
  granule_cumulus_id: number,
  checksum_type?: string,
  checksum_value?: string,
  file_name?: string,
  file_size?: number,
  path?: string,
  source?: string,
}

// file_size is stored as a BigInt in Postgres. It returns from PG to Node
// as a "string" type.
export interface PostgresFileRecord extends Omit<PostgresFile, 'file_size'> {
  bucket: string,
  key: string,
  file_size?: string,
  cumulus_id: number,
  created_at: Date,
  updated_at: Date,
}