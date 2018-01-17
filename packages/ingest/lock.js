'use strict';

const logger = require('./log');
const aws = require('@cumulus/common/aws');
const lockPrefix = 'lock';

const log = logger.child({ file: 'ingest/lock.js' });

function delay(t) {
  return new Promise((resolve) => {
    setTimeout(resolve, t);
  });
}

function countLock(bucket, pName) {
  return aws.s3().listObjectsV2({
    Bucket: bucket,
    Prefix: pName
  }).promise()
    .then((data) => data.Contents.length);
}

function addLock(bucket, pName, filename) {
  return aws.s3().putObject({
    Bucket: bucket,
    Key: `${lockPrefix}/${pName}/${filename}`,
    Body: ''
  }).promise();
}

function removeLock(bucket, pName, filename) {
  return aws.s3().deleteObject({
    Bucket: bucket,
    Key: `${lockPrefix}/${pName}/${filename}`
  }).promise();
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
