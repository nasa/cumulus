/* eslint no-console: "off" */

'use strict';

/**
 * Functionality for locking stacks with expiration and SHA tracking
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


class CumulusLockCollisionError extends Error {
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
      return (gitSHA === record.Item.sha ? 'match' : record.Item.sha);
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
      if (!['match', 'noLock'].includes(shaCheck)) {
        throw new CumulusLockError(`Cannot unlock stack, lock already exists from another build with SHA ${shaCheck}, error: ${e}`);
      }
      throw e;
    }
    return deleteResult;
  }
}

const LOCK_TABLE_NAME = 'cumulus-int-test-lock';
const STACK_EXPIRATION_MS = 120 * 60 * 1000; // 2 hourst

/**
 * lockOperation
 * @param {String} operation  - confirmLock or lock
 * @param {String} gitSHA     - git SHA to add to sha lock column
 * @param {String} deployment - Deployment/stack name
 * @param {String} shouldLock - true/false flag to add or remove the lock when used with
 *                              lock operation
 * @returns {Promise}         - On failure, exit code is
 */
async function lockOperation(operation, gitSHA, deployment, shouldLock) {
  const dynamodbDocClient = aws.dynamodbDocClient({
    convertEmptyValues: true
  });
  const mutex = new Mutex(dynamodbDocClient, LOCK_TABLE_NAME);

  if (operation === 'confirmLock') {
    const lockSHA = await mutex.checkMatchingSha(deployment, gitSHA);
    if (lockSHA === 'noLock') {
      throw new CumulusLockCollisionError(`No lock exists: ${deployment} - ${gitSHA}`);
    } else if (lockSHA !== 'match') {
      throw new Error(`Build with SHA ${JSON.stringify(lockSHA)} has provisioned this stack - you must re-run the full build`);
    }
    return Promise.resolve();
  }

  if (operation === 'lock') {
    if (shouldLock === 'true') {
      return mutex.writeLock(deployment, STACK_EXPIRATION_MS, gitSHA);
    }
    if (shouldLock === 'false') {
      return mutex.unlock(deployment, gitSHA);
    }
    throw new Error(`Invalid lock status ${shouldLock}, it must be true or false`);
  }
  throw new Error(`Invalid operation ${operation} selected.   Please choose 'lock' or 'confirmLock'`);
}

/**
 * Usage
 * --------
 * node lock-stack.js lock SHA stackname/deployment true/false - Set stack lock status to
 * true/false with SHA
 *   Returns exit code 1 if an unknown error occurs, error code 100 if a insert collision due to
 *   write constraints
 *
 * node lock-stack.js confirmLock SHA stackname/deployment - Check lock status for a stack.
 *   Returns exit code 1 if another stack/SHA has provisioned or another error, 101 if no lock exists
 */
lockOperation(...process.argv.slice(2, 6)).catch((e) => {
  console.dir(e);
  process.exitCode = 100;
  if (e.code === 'CumulusLockCollisionError'){
    process.exitCode = 101;
  }
  if (!['ConditionalCheckFailedException', 'CumulusLockError'].includes(e.code)) {
    process.exitCode = 1;
  }

});
