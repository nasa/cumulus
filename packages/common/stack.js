const getBucketsConfigKey = (stackName) => `${stackName}/workflows/buckets.json`;
const getDistributionBucketMapKey = (stackName) => `${stackName}/distribution_bucket_map.json`;

module.exports = {
  getBucketsConfigKey,
  getDistributionBucketMapKey
};
