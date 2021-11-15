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

export type BucketConfig = {
  name: string,
  type: string
};

export type BucketsConfigObject = {
  [key: string]: BucketConfig
};
