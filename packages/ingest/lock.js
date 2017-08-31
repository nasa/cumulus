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
  const list = await aws.S3.list(bucket, `${lockPrefix}/${pName}`);
  return list.Contents.length;
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
    log.info({ provider: provider.id }, 'Reached the connection limit, trying again');
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
