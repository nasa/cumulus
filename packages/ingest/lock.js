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
* Check Old Locks
* Checks all locks and removes those older than five minutes
*
* @param {Object} bucket - The AWS S3 bucket with the locks to check
* @param {string} list - The list of locks in the bucket
* @returns {boolean} - Number of locks remaining in bucket
**/
async function checkOldLocks(bucket, list) {
  if (list) {
    let count = list.length;

    list.forEach(async (item) => {
      const date = list[item].LastModified;
      const diff = new Date() - date;
      const fiveMinutes = 300000; // 5 * 60 seconds * 1000 milliseconds
      if (diff > fiveMinutes) {
        await deleteS3Object(bucket, list[item].Key);
        count -= 1;
      }
    });

    return count;
  }
  return 0;
}

/**
* Count Lock
* Counts the number of locks in a bucket
*
* @param {Object} bucket - The AWS S3 bucket to check
* @param {string} pName - The provider name
* @returns {integer} - Number of current locks in the bucket
**/
async function countLock(bucket, pName) {
  const list = await listS3ObjectsV2({
    Bucket: bucket,
    Prefix: `${lockPrefix}/${pName}`
  });
  const count = checkOldLocks(bucket, list.Contents);
  return count;
}

function addLock(bucket, pName, filename) {
  return s3PutObject({
    Bucket: bucket,
    Key: `${lockPrefix}/${pName}/${filename}`,
    Body: ''
  });
}

function removeLock(bucket, pName, filename) {
  return deleteS3Object(
    bucket,
    `${lockPrefix}/${pName}/${filename}`
  );
}

async function proceed(bucket, provider, filename, counter = 0) {
  // try to proceed for 270 seconds
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

module.exports.removeLock = removeLock;
module.exports.proceed = proceed;
