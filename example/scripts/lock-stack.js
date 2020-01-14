/* eslint no-console: "off" */

'use strict';

/**
 * Functionality for locking stacks with expiration
 *
 * To use this, a DynamoDB table is required with the primary partition key being
 * a string - 'key' and no sort key. The table name should be set in LOCK_TABLE_NAME
 */

const { aws } = require('@cumulus/common');

class CumulusLockError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class Mutex {
  constructor(docClient, tableName) {
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async checkMatchingSha(key, gitSHA) {
    const params = {
      TableName: this.tableName,
      Key: {
        key: key
      }
    };
    const record = await this.docClient.get(params).promise();
    if (record.Item) {
      return (gitSHA === record.Item.sha ? 'true' : record.Item.sha);
    }
    return 'noLock';
  }


  async writeLock(key, timeoutMs, gitSHA) {
    const now = Date.now();
    const params = {
      TableName: this.tableName,
      Item: {
        key: key,
        expire: now + timeoutMs,
        sha: gitSHA
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

  async unlock(key, gitSHA) {
    const params = {
      TableName: this.tableName,
      Key: { key: key },
      ConditionExpression: '#sha = :sha OR attribute_not_exists(sha)',
      ExpressionAttributeNames: {
        '#sha': 'sha'
      },
      ExpressionAttributeValues: {
        ':sha': gitSHA
      }
    };

    let deleteResult;
    try {
      deleteResult = await this.docClient.delete(params).promise();
    } catch (e) {
      const shaCheck = await this.checkMatchingSha(key, gitSHA);
      if (!['true', 'noLock'].includes(shaCheck)) {
        throw new CumulusLockError(`Cannot unlock stack, lock already exists from another build with SHA ${shaCheck}, error: ${e}`);
      }
      throw e;
    }
    return deleteResult;
  }
}

const LOCK_TABLE_NAME = 'cumulus-int-test-lock';
const STACK_EXPIRATION_MS = 120 * 60 * 1000; // 2 hourst

function performLock(mutex, deployment, gitSHA) {
  return mutex.writeLock(deployment, STACK_EXPIRATION_MS, gitSHA);
}

async function removeLock(mutex, deployment, gitSHA) {
  return mutex.unlock(deployment, gitSHA);
}

async function runLock(operation, gitSHA, deployment, lockFile) {
  const dynamodbDocClient = aws.dynamodbDocClient({
    convertEmptyValues: true
  });
  const mutex = new Mutex(dynamodbDocClient, LOCK_TABLE_NAME);
  if (operation === 'confirmLock') {
    const lockSHA = await mutex.checkMatchingSha(deployment, gitSHA);
    if (lockSHA === 'noLock') {
      console.log(`No lockfile exists: ${deployment} - ${gitSHA}`);
      process.exitCode = 101;
    } else if (lockSHA !== 'true') {
      throw new Error(`Build with SHA ${JSON.stringify(lockSHA)} has provisioned this stack - you must re-run the full build`);
    }
    return Promise.resolve();
  }
  if (operation === 'lock') {
    if (lockFile === 'true') {
      return performLock(mutex, deployment, gitSHA);
    }
    return removeLock(mutex, deployment, gitSHA);
  }
  throw new Error(`Invalid operation ${operation} selected.   Please choose 'lock' or 'confirmLock'`);
}

// Assuming this is run as:
// node lock-stack.js (true|false) deployment-name SHA
// true to lock, false to unlock
runLock(process.argv[2], process.argv[3], process.argv[4], process.argv[5]).catch((e) => {
  console.dir(e);
  process.exitCode = 100;
  if (!['ConditionalCheckFailedException', 'CumulusLockError'].includes(e.code)) {
    process.exitCode = 1;
  }
});
