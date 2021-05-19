'use strict';

import urljoin from 'url-join';

import { MissingBucketMap } from '@cumulus/errors';
import { getJsonS3Object } from '@cumulus/aws-client/S3';

import { DistributionBucketMap } from './types';

export const getDistributionBucketMapKey = (stackName: string) =>
  `${stackName}/distribution_bucket_map.json`;

export async function fetchDistributionBucketMap(): Promise<DistributionBucketMap> {
  const distributionBucketMap = await getJsonS3Object(
    process.env.system_bucket || '',
    getDistributionBucketMapKey(process.env.stackName || '')
  );
  return distributionBucketMap;
}

export function constructDistributionUrl(
  fileBucket: string,
  fileKey: string,
  distEndpoint: string,
  distributionBucketMap: DistributionBucketMap
): string {
  const bucketPath = distributionBucketMap[fileBucket];
  if (!bucketPath) {
    throw new MissingBucketMap(`No distribution bucket mapping exists for ${fileBucket}`);
  }

  const urlPath = urljoin(bucketPath, fileKey);
  return urljoin(distEndpoint, urlPath);
}
