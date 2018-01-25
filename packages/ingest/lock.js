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

async function countLock(bucket, pName) {
  var list = await aws.S3.list(bucket, `${lockPrefix}/${pName}`);
  var count = list.Contents.length;
  var item;
  for (item in list.Contents) {
    var date = list.Contents[item].LastModified;
    var diff = new Date() - date;
    if (diff > 300000) {
      removeOldLock(bucket, list.Contents[item].Key);
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

async function removeOldLock(bucket, key) {
  return aws.S3.delete(bucket, key);
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
