export interface GranuleFile {
  bucket: string,
  key: string,
  [key: string]: unknown
}

export interface Granule {
  files: GranuleFile[],
  [key: string]: unknown
}

export interface HandlerInput {
  granules: Granule[],
  [key: string]: unknown
}

export interface HandlerOutput {
  granules: Granule[],
  copied_to_orca: [string]
}

export interface HandlerEvent {
  config: {
    providerId: string,
    executionId: string,
    collectionShortname: string,
    collectionVersion: string,
    [key: string]: unknown
  },
  input: HandlerInput,
  cumulus_config?: {
    execution_name?: string,
    state_machine?: string,
    [key: string]: unknown
  }
}
