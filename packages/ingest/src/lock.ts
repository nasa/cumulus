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
* of locks that are not older than five minutes.
*
* @param {Object} bucket - The AWS S3 bucket with the locks to check
* @param {Array} locks - The list of locks in the bucket
* @returns {integer} - Number of locks remaining in bucket
**/
export async function checkOldLocks(
  bucket: string,
  locks: Lock[] = []
): Promise<number> {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

  const expiredLocks = locks.filter(
    (lock) => {
      if (!lock.LastModified) {
        throw new TypeError(`Could not find LastModified on ${JSON.stringify(lock)}`);
      }
      return lock.LastModified.getTime() < fiveMinutesAgo;
    }
  );

  await Promise.all(expiredLocks.map((lock) => {
    if (!lock.Key) {
      throw new TypeError(`Could not find Key on ${JSON.stringify(lock)}`);
    }
    return deleteS3Object(bucket, lock.Key);
  }));

  return locks.length - expiredLocks.length;
}

/**
* Counts the number of locks in a bucket.
*
* @param {Object} bucket - The AWS S3 bucket to check
* @param {string} providerName - The provider name
* @returns {integer} - Number of current locks in the bucket
**/
export async function countLock(
  bucket: string,
  providerName: string
): Promise<number> {
  const locks = await listS3ObjectsV2({
    Bucket: bucket,
    Prefix: `${lockPrefix}/${providerName}`,
  });

  return checkOldLocks(bucket, locks);
}

async function addLock(
  bucket: string,
  providerName: string,
  filename: string,
  ACL?: string
): Promise<void> {
  const key = `${lockPrefix}/${providerName}/${filename}`;
  await s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: '',
    ACL,
  });
}

export async function removeLock(
  bucket: string,
  providerName: string,
  filename: string
): Promise<void> {
  await deleteS3Object(
    bucket,
    `${lockPrefix}/${providerName}/${filename}`
  );
}

/**
 *
 * @param {string} bucket
 * @param {Object} provider
 * @param {string} provider.id
 * @param {number} provider.globalConnectionLimit
 * @param {string} filename
 * @param {number} counter
 * @param {string} ACL
 * @returns {Promise<boolean>}
 */
export async function proceed(
  bucket: string,
  provider: {
    id: string,
    globalConnectionLimit?: number
  },
  filename: string,
  counter = 0,
  ACL: string
): Promise<boolean> {
  if (provider.globalConnectionLimit === undefined) {
    return true;
  }

  // Fail if lock is not removed after 270 tries.
  if (counter > 270) {
    return false;
  }

  const globalConnectionLimit = provider.globalConnectionLimit;

  const count = await countLock(bucket, provider.id);

  if (count >= globalConnectionLimit) {
    log.debug(`The "${provider.id}" provider's globalConnectionLimit of "${provider.globalConnectionLimit}" has been reached.`);
    // wait for 5 second and try again
    await sleep(5000);
    return proceed(bucket, provider, filename, counter + 1, ACL);
  }

  // add the lock
  await addLock(bucket, provider.id, filename, ACL);
  return true;
}
