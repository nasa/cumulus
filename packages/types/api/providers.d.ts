export interface ProviderRecord {
  id: string,
  globalConnectionLimit?: number,
  protocol: string,
  host: string,
  port?: number,
  username?: string,
  password?: string,
  encrypted?: boolean,
  createdAt: number,
  updatedAt?: number,
  privateKey?: string,
  cmKeyId?: string,
  certificateUri?: string
}

export interface PostgresProviderRecord {
  cumulusId?: number,
  name: string,
  globalConnectionLimit?: number,
  protocol: string,
  host: string,
  port?: number,
  username?: string,
  password?: string,
  created_at?: number,
  updated_at?: number,
  privateKey?: string,
  cmKeyId?: string,
  certificateUri?: string
  [key: string]: any
}
