'use strict';

import urljoin from 'url-join';

import { envUtils } from '@cumulus/common';
import { InvalidArgument, MissingBucketMap } from '@cumulus/errors';
import { getJsonS3Object } from '@cumulus/aws-client/S3';

import { DistributionBucketMap } from './types';

export const getDistributionBucketMapKey = (stackName: string) =>
  `${stackName}/distribution_bucket_map.json`;

export async function fetchDistributionBucketMap(
  systemBucket: string = envUtils.getRequiredEnvVar('system_bucket'),
  stackName: string = envUtils.getRequiredEnvVar('stackName')
): Promise<DistributionBucketMap> {
  const distributionBucketMap = await getJsonS3Object(
    systemBucket,
    getDistributionBucketMapKey(stackName)
  );
  return distributionBucketMap;
}

export function constructDistributionUrl(
  fileBucket: string,
  fileKey: string,
  distributionBucketMap: DistributionBucketMap,
  distributionEndpoint?: string
): string {
  if (!distributionEndpoint) {
    throw new InvalidArgument(`Cannot construct distribution url with host ${distributionEndpoint}`);
  }
  const bucketPath = distributionBucketMap[fileBucket];
  if (!bucketPath) {
    throw new MissingBucketMap(`No distribution bucket mapping exists for ${fileBucket}`);
  }
  const urlPath = urljoin(bucketPath, fileKey);
  return urljoin(distributionEndpoint, urlPath);
}

export function resolveDistributionEndpoint(
  cmrProvider: string | undefined,
  endpointMap: Record<string, string> | undefined,
  defaultEndpoint?: string
): string {
  if (cmrProvider && endpointMap && endpointMap[cmrProvider]) {
    return endpointMap[cmrProvider];
  }
  if (defaultEndpoint) {
    return defaultEndpoint;
  }
  throw new InvalidArgument(
    `Cannot resolve distribution endpoint: no entry for cmrProvider="${cmrProvider}" and no default endpoint configured`
  );
}
