import { AssumeRoleResponse } from '@cumulus/aws-client/STS';

export interface HandlerInput {
  granules: MessageGranule[],
  [key: string]: unknown
}

export interface HandlerConfig {
  urlType: 's3' | 'cloudfront',
  cloudfrontEndpoint?: string,
  failTaskWhenFileBackupFail?: boolean,
  lzardsProvider?: string,
}

export interface HandlerEvent {
  input: HandlerInput,
  config: HandlerConfig,
}

export type MakeBackupFileRequestResult = {
  statusCode?: number
  granuleId: string,
  collectionId: string,
  filename: string,
  provider: string,
  createdAt: number,
  producerGranuleId: string,
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
  producerGranuleId?: string,
}

export interface MessageGranuleFromStepOutput extends BaseMessageGranule {
  dataType: string,
  version: string,
  files: MessageGranuleFilesObject[],
  provider: string,
  createdAt: number,
}

export interface ApiGranule extends BaseMessageGranule {
  collectionId: string,
  provider: string,
  createdAt: number,
}

export type MessageGranule = MessageGranuleFromStepOutput | ApiGranule;
export interface GetCollectionFunctionParams {
  prefix: string
  query: {
    name: string,
    version: string,
  },
}

export interface BackupConfig extends HandlerConfig{
  roleCreds: AssumeRoleResponse,
  authToken: string,
}
