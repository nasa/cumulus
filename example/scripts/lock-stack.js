/* eslint no-console: "off" */

'use strict';

/**
 * Functionality for locking stacks with expiration using the Mutex provided by
 * @cumulus/common. Stacks are locked based on the deployment name.
 *
 * To use this, a DynamoDB table is required with the primary partition key being
 * a string - 'key' and no sort key. The table name should be set in LOCK_TABLE_NAME
 */

const {
  concurrency
} = require('@cumulus/common');
const aws = require('@cumulus/common/aws');

const LOCK_TABLE_NAME = 'cumulus-int-test-lock';
const STACK_EXPIRATION_MS = 120 * 60 * 1000; // 2 hours

async function performLock(mutex, deployment, cb) {
  try {
    await mutex.writeLock(deployment, STACK_EXPIRATION_MS);

    return cb(0);
  }
  catch (e) {
    return cb(1);
  }
}

async function removeLock(mutex, deployment, cb) {
  try {
    await mutex.unlock(deployment);

    return cb(0);
  }
  catch (e) {
    return cb(1);
  }
}

async function updateLock(lockFile, deployment, cb) {
  const dynamodbDocClient = aws.dynamodbDocClient({
    convertEmptyValues: true
  });

  const mutex = new concurrency.Mutex(dynamodbDocClient, LOCK_TABLE_NAME);

  if (lockFile === 'true') {
    return performLock(mutex, deployment, cb);
  }

  return removeLock(mutex, deployment, cb);
}

// Assuming this is run as:
// node lock-stack.js (true|false) deployment-name
// true to lock, false to unlock
updateLock(process.argv[2], process.argv[3], console.log);
