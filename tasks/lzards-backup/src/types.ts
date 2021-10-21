export interface HandlerInput {
  granules: MessageGranule[],
  [key: string]: unknown
}

export interface HandlerConfig {
  urlType: 's3' | 'cloudfront',
  cloudfrontEndpoint?: string,
}

export interface HandlerEvent {
  input: HandlerInput,
  config: HandlerConfig,
}

export type MakeBackupFileRequestResult = {
  statusCode?: number
  granuleId: string,
  filename: string,
  body?: string,
  status: 'COMPLETED' | 'FAILED',
};

export type MessageGranuleFilesObject = {
  checksumType?: string,
  checksum?: string,
  filename: string,
  name: string,
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
  },
}
