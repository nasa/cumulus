import Logger from '@cumulus/logger';
import pRetry from 'p-retry';
import got from 'got';

import { bucketMapResponse } from './types';

const log = new Logger({ sender: '@cumulus/tea-map-cache/tea' });

/**
 * getTeaBucketPath

 * @param {Object} params             - parameters
 * @param {string} params.bucket      - Bucket name to get TEA path mapping
 * @param {string} params.teaEndPoint - TEA API URL
 * @param {number} [params.retries]   - retries override for pRetry
 * @returns {Promise<string>}         - TEA path for the given bucket
 */
export const getTeaBucketPath = async (params: {
  bucket: string,
  teaEndPoint: string,
  retries?: number
}): Promise<string> => {
  const {
    bucket,
    teaEndPoint,
    retries = 5
  } = params;
  return pRetry(
    async () => {
      let apiResponse;
      try {
        apiResponse = await got.get(`${teaEndPoint}/locate?bucket_name=${bucket}`);
      } catch (error) {
        if (error.name === 'HTTPError' && error.statusCode === 404) {
          if (error.response.body.includes(`No route defined for ${bucket}`)) {
            log.warn(`Warning: Deployment initialized with no distribution bucket map for ${bucket}`);
            return '';
          }
        }
        throw error;
      }
      const bucketMapList = <bucketMapResponse>JSON.parse(apiResponse.body);
      if (bucketMapList.length > 1) {
        throw new pRetry.AbortError(`BucketMap configured with multiple responses from ${bucket},
        this package cannot resolve a distirbution URL as configured for this bucket`);
      }
      return bucketMapList[0];
    },
    { retries, minTimeout: 1000, maxTimeout: 5000 }
  );
};
