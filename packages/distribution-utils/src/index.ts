
import urljoin from 'url-join';

import { MissingBucketMap } from '@cumulus/errors';

import { DistributionBucketMap } from './types';


export function constructDistributionUrl(
  fileBucket: string,
  fileKey: string,
  distEndpoint: string,
  distributionBucketMap: DistributionBucketMap,
): string {
  const bucketPath = distributionBucketMap[fileBucket];
  if (!bucketPath) {
    throw new MissingBucketMap(`No distribution bucket mapping exists for ${fileBucket}`);
  }

  const urlPath = urljoin(bucketPath, fileKey);
  return urljoin(distEndpoint, urlPath);
};
