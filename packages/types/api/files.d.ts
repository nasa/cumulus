export interface ApiFile {
  bucket?: string
  checksum?: string
  checksumType?: string
  createdAt: Date
  fileName?: string
  filename?: string
  granuleId: string
  key?: string
  name?: string
  path?: string
  size?: number
  source?: string
  type?: string
  updatedAt: Date
}

export type ApiFileGranuleIdOptional = Omit<ApiFile, 'granuleId'> & {
  granuleId?: string;
};
