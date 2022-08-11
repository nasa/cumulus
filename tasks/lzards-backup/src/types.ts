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
  bucket: string,
  key: string,
};

export interface BaseMessageGranule {
  granuleId: string,
  files: MessageGranuleFilesObject[],
}

export interface MessageGranuleFromStepOutput extends BaseMessageGranule {
  dataType: string,
  version: string,
}

export interface ApiGranule extends BaseMessageGranule {
  collectionId: string,
}

export type MessageGranule = MessageGranuleFromStepOutput | ApiGranule;
export interface GetCollectionFunctionParams {
  prefix: string
  query: {
    name: string,
    version: string,
  },
}
