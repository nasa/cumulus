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
  cmrGranuleUrlType?: string,
  concurrency?: number,
  distribution_endpoint?: string,
  invalidGranuleBehavior?: string,
  s3MultipartChunksizeMb?: number,
  // this last is not a valid member of production configuration
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
  fileName: string,
  key: string,
} & ApiFile;

export type ValidApiGranuleFile = Omit<ValidApiFile, 'granuleId'>;
export type ValidGranuleRecord = {
  files: ValidApiGranuleFile[]
} & ApiGranuleRecord;

export type MassagedEventConfig = {
  chunkSize?: number,
  cmrGranuleUrlType: string,
  invalidGranuleBehavior: string,
  targetCollection: CollectionRecord,
  concurrency: number
} & EventConfig;
