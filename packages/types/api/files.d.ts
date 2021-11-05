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
  size?: string,
  // TODO -- Was this *originally actually a
  // number coming from the endpoints or are we the victim of duck typing here
  // hopefully yes.
  source?: string
  type?: string
  updatedAt: Date
}
