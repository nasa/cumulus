export interface GranuleFile {
  checksumType?: string,
  checksum?: string,
  filename: string
}

export interface Granule {
  files: GranuleFile[]
}

export interface HandlerEvent {
  config: {
    algorithm: string
  },
  input: {
    granules: Granule[]
  }
}
