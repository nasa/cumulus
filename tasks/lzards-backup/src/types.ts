export interface HandlerInput {
  granules: MessageGranule[],
  [key: string]: unknown
}

export interface HandlerEvent {
  config: {
    algorithm: string
  },
  input: HandlerInput
}

export type makeBackupFileRequestResult = {
  statusCode?: number
  granuleId: string,
  filename: string,
  body?: string,
  status: 'COMPLETED' | 'FAILED' | 'INTERNAL FAILURE'
};

export type MessageGranuleFilesObject = {
  checksumType: string,
  checksum: string,
  filename: string,
  name: string,
  backup: boolean,
  filepath: string,
  bucket: string,
};

export interface MessageGranule {
  granuleId: string,
  dataType: string,
  version: string,
  files: MessageGranuleFilesObject[],
}
export interface GetCollectionFunctionParams {
  prefix: string
  query: {
    name: string,
    version: string,
  }
}
