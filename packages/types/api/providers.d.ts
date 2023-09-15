export interface ApiProvider {
  id: string,
  globalConnectionLimit?: number,
  maxDownloadTime?: number,
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
  allowedRedirects?: string[]
}
