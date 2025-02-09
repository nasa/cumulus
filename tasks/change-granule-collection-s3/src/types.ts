import { BucketsConfigObject } from '@cumulus/common/types';
import { ApiFile, ApiGranuleRecord, CollectionRecord } from '@cumulus/types';
export const MB = 1024 * 1024;

type TestApiClientMethods = {
  getGranuleMethod: (params: { granuleId: string }) => ApiGranuleRecord,
  getCollectionMethod: (params: {
    collectionName: string,
    collectionVersion: string
  }) => CollectionRecord
};

export type EventConfig = {
  targetCollection: {
    name: string,
    version: string,
  }
  buckets: BucketsConfigObject,
  s3MultipartChunksizeMb?: number,
  distribution_endpoint: string,
  cmrGranuleUrlType: string,
  invalidBehavior: string,
  // this last is not a valid member of production cofiguration
  testApiClientMethods?: TestApiClientMethods
};

export type ChangeCollectionsS3Event = {
  config: EventConfig,
  cumulus_config?: {
    cumulus_context?: {
      forceDuplicateOverwrite?: boolean,
    }
  },
  input: {
    granuleIds: Array<string>,
  }
};

export type ValidApiFile = {
  bucket: string,
  key: string
} & ApiFile;

export type ValidApiGranuleFile = Omit<ValidApiFile, 'granuleId'>;
export type ValidGranuleRecord = {
  files: ValidApiGranuleFile[]
} & ApiGranuleRecord;
