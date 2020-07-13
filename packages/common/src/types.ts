export type AwsCloudWatchEvent = {
  id: string,
  'detail-type': string,
  source: string,
  account: string,
  time: string,
  region: string,
  resources: string[],
  detail: {
    status?: string,
    input?: string,
    output?: string
  }
};

export type BucketType = 'internal' | 'private' | 'protected' | 'public' | 'shared';

export type BucketConfig = {
  name: string,
  type: BucketType
};

export type BucketsConfigObject = {
  [key: string]: BucketConfig
};
