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

function performLock(mutex, deployment) {
  return mutex.writeLock(deployment, STACK_EXPIRATION_MS);
}

function removeLock(mutex, deployment) {
  return mutex.unlock(deployment);
}

function updateLock(lockFile, deployment) {
  const dynamodbDocClient = aws.dynamodbDocClient({
    convertEmptyValues: true
  });
  const mutex = new concurrency.Mutex(dynamodbDocClient, LOCK_TABLE_NAME);

  if (lockFile === 'true') {
    return performLock(mutex, deployment);
  }
  return removeLock(mutex, deployment);
}

// Assuming this is run as:
// node lock-stack.js (true|false) deployment-name
// true to lock, false to unlock
updateLock(process.argv[2], process.argv[3]).catch((e) => {
  console.log(e);
  process.exit(100);
});
