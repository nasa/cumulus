import {
  s3PutObject,
  deleteS3Object,
  listS3ObjectsV2,
} from '@cumulus/aws-client/S3';
import { sleep } from '@cumulus/common';
import * as log from '@cumulus/common/log';

const lockPrefix = 'lock';

export interface Lock {
  Key?: string,
  LastModified?: Date
}

/**
 * Checks all locks and removes those older than five minutes. Returns a count
 * of locks that are not older than configured retention period or 5 minutes.
 *
 * @param {object} bucket - The AWS S3 bucket with the locks to check
 * @param {Array} locks - The list of locks in the bucket
 * @param {number} retentionTimeInSecond - lock retention time in second, default is 300
 * @returns {integer} - Number of locks remaining in bucket
 */
export async function checkOldLocks(
  bucket: string,
  locks: Lock[] = [],
  retentionTimeInSecond: number = 300
): Promise<number> {
  const expirationTimestamp = Date.now() - (retentionTimeInSecond * 1000);

  const expiredLocks = locks.filter(
    (lock) => {
      if (!lock.LastModified) {
        throw new TypeError(`Could not find LastModified on ${JSON.stringify(lock)}`);
      }
      return lock.LastModified.getTime() < expirationTimestamp;
    }
  );

  await Promise.all(expiredLocks.map((lock) => {
    if (!lock.Key) {
      throw new TypeError(`Could not find Key on ${JSON.stringify(lock)}`);
    }
    log.debug(`Removing expired lock ${JSON.stringify(lock)}`);
    return deleteS3Object(bucket, lock.Key);
  }));

  return locks.length - expiredLocks.length;
}

/**
 * Counts the number of locks in a bucket.
 *
 * @param {object} bucket - The AWS S3 bucket to check
 * @param {string} providerName - The provider name
 * @param {number} retentionTimeInSecond - lock retention time in second, default is 300
 * @returns {integer} - Number of current locks in the bucket
 */
export async function countLock(
  bucket: string,
  providerName: string,
  retentionTimeInSecond?: number
): Promise<number> {
  const locks = await listS3ObjectsV2({
    Bucket: bucket,
    Prefix: `${lockPrefix}/${providerName}`,
  });

  return checkOldLocks(bucket, locks, retentionTimeInSecond);
}

async function addLock(
  bucket: string,
  providerName: string,
  granuleId: string
): Promise<void> {
  const key = `${lockPrefix}/${providerName}/${granuleId}`;
  await s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: '',
  });
}

export async function removeLock(
  bucket: string,
  providerName: string,
  granuleId: string
): Promise<void> {
  await deleteS3Object(
    bucket,
    `${lockPrefix}/${providerName}/${granuleId}`
  );
}

/**
 *
 * @param {string} bucket - system bucket to place the lock files
 * @param {object} provider - provider object
 * @param {string} provider.id - provider id
 * @param {number} provider.globalConnectionLimit - provider globalConnectionLimit
 * @param {number} provider.maxDownloadTime - provider maxDownloadTime for a granule
 * @param {string} granuleId - id of downloading granule
 * @param {number} counter - retry counter
 * @returns {Promise<boolean>}
 */
export async function proceed(
  bucket: string,
  provider: {
    id: string,
    globalConnectionLimit?: number,
    maxDownloadTime?: number,
  },
  granuleId: string,
  counter = 0
): Promise<boolean> {
  const { globalConnectionLimit, maxDownloadTime } = provider;
  if (globalConnectionLimit === undefined) {
    return true;
  }

  // Fail if lock is not removed after 270 tries.
  if (counter > 270) {
    log.debug(`The "${provider.id}" provider no lock available after ${counter} retries`);
    return false;
  }

  const count = await countLock(bucket, provider.id, maxDownloadTime);

  if (count >= globalConnectionLimit) {
    log.debug(`The "${provider.id}" provider's globalConnectionLimit of "${provider.globalConnectionLimit}" has been reached.`);
    // wait for 5 second and try again
    await sleep(5000);
    return proceed(bucket, provider, granuleId, counter + 1);
  }

  // add the lock
  await addLock(bucket, provider.id, granuleId);
  return true;
}
