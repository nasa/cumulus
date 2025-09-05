import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { BucketsConfigObject } from '@cumulus/common/types';
import { ApiGranuleRecord, CollectionRecord, ApiFileGranuleIdOptional } from '@cumulus/types';
export const MB = 1024 * 1024;

type TestMethods = {
  listGranulesMethod: (params: Object) => Promise<ApiGatewayLambdaHttpProxyResponse>,
  getCollectionMethod: (params: {
    collectionName: string,
    collectionVersion: string
  }) => CollectionRecord,
  getMetadataFunction: (s3url: string) => Object
};

export type EventConfig = {
  targetCollection: {
    name: string,
    version: string,
  }
  collection: {
    name: string,
    version: string,
  }
  buckets: BucketsConfigObject,
  cmrGranuleUrlType?: string,
  concurrency?: number,
  s3Concurrency?: number,
  listGranulesConcurrency?: number,
  distribution_endpoint?: string,
  invalidGranuleBehavior?: string,
  s3MultipartChunksizeMb?: number,
  // these last are not valid members of production configuration
  testMethods?: TestMethods

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
  fileName?: string,
  key: string,
} & ApiFileGranuleIdOptional;

export type ValidApiGranuleFile = Omit<ValidApiFile, 'granuleId'>;
export type ValidGranuleRecord = {
  files: ValidApiGranuleFile[]
} & ApiGranuleRecord;

export type MassagedEventConfig = {
  chunkSize?: number,
  cmrGranuleUrlType: string,
  invalidGranuleBehavior: string,
  targetCollection: CollectionRecord,
  concurrency: number,
  s3Concurrency: number,
  listGranulesConcurrency: number,
} & EventConfig;
