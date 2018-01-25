'use strict';

const logger = require('./log');
const aws = require('./aws');
const lockPrefix = 'lock';

const log = logger.child({ file: 'ingest/lock.js' });

async function delay(t) {
  return new Promise((resolve) => {
    setTimeout(resolve, t);
  });
}

/**
* Count Lock
* Counts the number of locks in a bucket
*
* @param {Object} bucket - The AWS S3 bucket to check
* @param {String} pName - The provider name
* @returns {Integer} - Number of current locks in the bucket
**/
async function countLock(bucket, pName) {
  var list = await aws.S3.list(bucket, `${lockPrefix}/${pName}`);
  var count = checkOldLocks(bucket, list.Contents);
  return count;
}

/**
* Check Old Locks
* Checks all locks and removes those older than five minutes
*
* @param {Object} bucket - The AWS S3 bucket with the locks to check
* @param {String} list - The list of locks in the bucket
* @returns {Boolean} - Number of locks remaining in bucket
**/
async function checkOldLocks(bucket, list) {
  var count = list.length;
  var item;
  for (item in list) {
    var date = list[item].LastModified;
    var diff = new Date() - date;
    const fiveMinutes = 300000; // 5 * 60 seconds * 1000 milliseconds
    if (diff > fiveMinutes) {
      aws.S3.delete(bucket, list[item].Key);
      count--;
    }
  }
  return count;
}

async function addLock(bucket, pName, filename) {
  return aws.S3.put(bucket, `${lockPrefix}/${pName}/${filename}`, '');
}

async function removeLock(bucket, pName, filename) {
  return aws.S3.delete(bucket, `${lockPrefix}/${pName}/${filename}`);
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
    await delay(5000);
    return proceed(bucket, provider, filename, counter + 1);
  }

  // add the lock
  await addLock(bucket, provider.id, filename);
  return true;
}

module.exports.removeLock = removeLock;
module.exports.proceed = proceed;
