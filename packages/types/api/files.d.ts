export interface ApiFile {
  granuleId: string
  updatedAt: Date
  bucket?: string
  checksum?: string
  checksumType?: string
  createdAt: Date
  fileName?: string
  filename?: string
  key?: string
  name?: string
  path?: string
  size?: number
  source?: string
  type?: string
}
