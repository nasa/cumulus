/* eslint no-console: "off" */

'use strict';

/**
 * Functionality for locking stacks with expiration
 *
 * To use this, a DynamoDB table is required with the primary partition key being
 * a string - 'key' and no sort key. The table name should be set in LOCK_TABLE_NAME
 */

const { aws, log } = require('@cumulus/common');

class Mutex {
  constructor(docClient, tableName) {
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async lock(key, timeoutMs, fn) {
    log.info(`Attempting to obtain lock ${key}`);
    // Note: this throws an exception if the lock fails, desirable for Tasks
    await this.writeLock(key, timeoutMs);
    log.info(`Obtained lock ${key}`);
    let result = null;
    try {
      result = await fn();
    } finally {
      log.info(`Releasing lock ${key}`);
      await this.unlock(key);
      log.info(`Released lock ${key}`);
    }
    return result;
  }

  writeLock(key, timeoutMs) {
    const now = Date.now();

    const params = {
      TableName: this.tableName,
      Item: {
        key: key,
        expire: now + timeoutMs
      },
      ConditionExpression: '#key <> :key OR (#key = :key AND #expire < :expire)',
      ExpressionAttributeNames: {
        '#key': 'key',
        '#expire': 'expire'
      },
      ExpressionAttributeValues: {
        ':key': key,
        ':expire': now
      }
    };
    return this.docClient.put(params).promise();
  }

  unlock(key) {
    return this.docClient.delete({
      TableName: this.tableName,
      Key: { key: key }
    }).promise();
  }
}


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
  const mutex = new Mutex(dynamodbDocClient, LOCK_TABLE_NAME);

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
  console.dir(e);
  process.exitCode = 100;
  if (!e.code === 'ConditionalCheckFailedException') {
    console.log(e);
    process.exitCode = 1;
  }
});
