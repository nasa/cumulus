export interface ApiFile {
  granuleId: string
  bucket?: string
  key?: string
  fileName?: string
  name?: string
  path?: string
  size?: number
  source?: string
  checksumType?: string
  checksum?: string
  createdAt: Date
  updatedAt: Date
}
