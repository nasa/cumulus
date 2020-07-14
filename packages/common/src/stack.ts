export const getBucketsConfigKey = (stackName: string) =>
  `${stackName}/workflows/buckets.json`;

export const getDistributionBucketMapKey = (stackName: string) =>
  `${stackName}/distribution_bucket_map.json`;
