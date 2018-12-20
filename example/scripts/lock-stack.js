/* eslint no-console: "off" */

'use strict';

const {
  concurrency
} = require('@cumulus/common');
const aws = require('@cumulus/common/aws');

const STACK_EXPIRATION_MS = 120 * 1000;


async function performLock(mutex, deployment, cb) {
  try {
    await mutex.writeLock(deployment, STACK_EXPIRATION_MS);

    return cb(true);
  }
  catch (e) {
    return cb(`Error locking stack ${deployment}: ${e}`);
  }
}

async function removeLock(mutex, deployment, cb) {
  try {
    await mutex.unlock(deployment);

    return cb(true);
  }
  catch (e) {
    return cb(`Error unlocking stack ${deployment}: ${e}`);
  }
}

async function updateLock(lockFile, deployment, cb) {
  console.log(`deployment: ${deployment}`);

  const dynamodbDocClient = aws.dynamodbDocClient({
    convertEmptyValues: true
  });

  const mutex = new concurrency.Mutex(dynamodbDocClient, 'lf-test');

  if (lockFile === 'true') {
    return performLock(mutex, deployment, cb);
  }

  return removeLock(mutex, deployment, cb);
}

updateLock(process.argv[2], process.argv[3], console.log);
