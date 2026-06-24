'use strict';

import urljoin from 'url-join';

import { envUtils } from '@cumulus/common';
import { InvalidArgument, MissingBucketMap } from '@cumulus/errors';
import { getJsonS3Object } from '@cumulus/aws-client/S3';

import { DistributionBucketMap } from './types';

interface BucketDetails {
  name: string;
  type: string;
}
interface DistributionBucketMap2 {
  [bucket: string]: BucketDetails
}

export const getDistributionBucketMapKey = (stackName: string) =>
  `${stackName}/distribution_bucket_map.json`;

export async function fetchDistributionBucketMap(
  systemBucket: string = envUtils.getRequiredEnvVar('system_bucket'),
  stackName: string = envUtils.getRequiredEnvVar('stackName')
): Promise<DistributionBucketMap> {
  const bucketMap = await getJsonS3Object(
    systemBucket,
    getDistributionBucketMapKey(stackName)
  ) as DistributionBucketMap2;

  return Object.fromEntries(Object.entries(bucketMap).map(([key, value]) => [key, value.name]))
}

export async function fetchDistributionTypedBucketMap(
  systemBucket: string = envUtils.getRequiredEnvVar('system_bucket'),
  stackName: string = envUtils.getRequiredEnvVar('stackName')
): Promise<DistributionBucketMap2> {
  const distributionBucketMap = await getJsonS3Object(
    systemBucket,
    getDistributionBucketMapKey(stackName)
  ) as DistributionBucketMap2;
  return distributionBucketMap;
}

export function constructDistributionUrl(
  fileBucket: string,
  fileKey: string,
  distributionBucketMap: DistributionBucketMap2,
  distributionEndpoint?: string
): string {
  if (!distributionEndpoint) {
    throw new InvalidArgument(`Cannot construct distribution url with host ${distributionEndpoint}`);
  }
  const bucketPath = distributionBucketMap[fileBucket];
  if (!bucketPath) {
    throw new MissingBucketMap(`No distribution bucket mapping exists for ${fileBucket}`);
  }
  const urlPath = urljoin(bucketPath.type, fileKey);
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
