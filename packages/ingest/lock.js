'use strict';

const {
  s3PutObject,
  deleteS3Object,
  listS3ObjectsV2
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const { sleep } = require('@cumulus/common/util');
const lockPrefix = 'lock';

/**
* Checks all locks and removes those older than five minutes. Returns a count
* of locks that are not older than five minutes.
*
* @param {Object} bucket - The AWS S3 bucket with the locks to check
* @param {Array} list - The list of locks in the bucket
* @returns {integer} - Number of locks remaining in bucket
**/
async function checkOldLocks(bucket, list) {
  if (list.length > 0) {
    const countResults = await Promise.all(list.map(async (item) => {
      const date = item.LastModified;
      const diff = new Date() - date;
      const fiveMinutes = 300000; // 5 * 60 seconds * 1000 milliseconds
      if (diff > fiveMinutes) {
        await deleteS3Object(bucket, item.Key);
        return 0;
      }
      return 1;
    }));

    const count = countResults.reduce((total, result) => total + result);
    return count;
  }
  return 0;
}

/**
* Counts the number of locks in a bucket.
*
* @param {Object} bucket - The AWS S3 bucket to check
* @param {string} providerName - The provider name
* @returns {integer} - Number of current locks in the bucket
**/
async function countLock(bucket, providerName) {
  const s3Objects = await listS3ObjectsV2({
    Bucket: bucket,
    Prefix: `${lockPrefix}/${providerName}`
  });
  return checkOldLocks(bucket, s3Objects);
}

function addLock(bucket, providerName, filename) {
  return s3PutObject({
    Bucket: bucket,
    Key: `${lockPrefix}/${providerName}/${filename}`,
    Body: ''
  });
}

function removeLock(bucket, providerName, filename) {
  return deleteS3Object(
    bucket,
    `${lockPrefix}/${providerName}/${filename}`
  );
}

async function proceed(bucket, provider, filename, counter = 0) {
  // Fail if lock is not removed after 270 tries.
  if (counter > 270) {
    return false;
  }

  const globalConnectionLimit = provider.globalConnectionLimit;

  const count = await countLock(bucket, provider.id);

  if (count >= globalConnectionLimit) {
    log.debug({ provider: provider.id }, 'Reached the connection limit, trying again');
    // wait for 5 second and try again
    await sleep(5000);
    return proceed(bucket, provider, filename, counter + 1);
  }

  // add the lock
  await addLock(bucket, provider.id, filename);
  return true;
}

module.exports = {
  checkOldLocks,
  countLock,
  proceed,
  removeLock
};
