const got = require('got');
const pRetry = require('p-retry');

/**
 * getTeaBucketPath
 *
 * @param {string} bucket - Bucket name to get TEA path mapping
 * @param {string} teaEndPoint - TEA API URL
 * @returns {string} TEA path for the given bucket
 */
async function getTeaBucketPath(bucket, teaEndPoint) {
  return pRetry(
    async () => {
      let apiResponse;
      try {
        apiResponse = await got.get(`${teaEndPoint}/locate?bucket_name=${bucket}`);
      } catch (error) {
        if (error.name === 'HTTPError' && error.statusCode === 404) {
          return '';
        }
        throw error;
      }
      const bucketMapList = JSON.parse(apiResponse.body);
      if (bucketMapList.length > 1) {
        throw new pRetry.AbortError(`BucketMap configured with multiple responses from ${bucket},
        this package cannot resolve a distirbution URL as configured for this bucket`);
      }
      return bucketMapList[0];
    },
    { retries: 5, minTimeout: 1000, maxTimeout: 5000 }
  );
}

module.exports = {
  getTeaBucketPath
};
