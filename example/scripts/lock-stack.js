/* eslint no-console: "off" */

'use strict';

/**
 * Functionality for locking stacks with expiration and SHA tracking
 *
 * To use this, a DynamoDB table is required with the primary partition key being
 * a string - 'key' and no sort key. The table name should be set in LOCK_TABLE_NAME
 */


const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const Mutex = require('./lib/Mutex');
class CumulusNoLockError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

const LOCK_TABLE_NAME = 'cumulus-int-test-lock';
const STACK_EXPIRATION_MS = 120 * 60 * 1000; // 2 hourst

/**
 * lockOperation
 * @param {string} operation           - confirmLock or lock
 * @param {string} gitSHA              - git SHA to add to sha lock column
 * @param {string} deployment          - Deployment/stack name
 * @param {string} shouldLock          - true/false flag to add or remove the lock when used with
 *                                       lock operation
 * @returns {Promise}                  - On success, returns resolved promise
 * @throws {CumulusLockCollisionError} - On 'confirmLock' missing a lock
 * @throws {CumulusNoLockError}         -on 'lock' locking collision
 */
async function lockOperation(operation, gitSHA, deployment, shouldLock) {
  const mutex = new Mutex(dynamodbDocClient({ convertEmptyValues: true }), LOCK_TABLE_NAME);

  if (operation === 'confirmLock') {
    const lockSHA = await mutex.checkMatchingSha(deployment, gitSHA);
    if (lockSHA === 'noLock') {
      throw new CumulusNoLockError(`No lock exists: ${deployment} - ${gitSHA}`);
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
 * node lock-stack.js lock SHA stackname/deployment true/false
 *   Set stack lock status to true/false with SHA key.
 *   Returns exit code 1 if an unknown error occurs, error code 100 if a insert collision due to
 *   write constraints.
 *
 * `node lock-stack.js confirmLock SHA stackname/deployment`
 *   Check lock status for a stack.
 *   Returns exit code 1 if another stack/SHA has provisioned or
 *   another error, 101 if no lock exists.
 */
lockOperation(...process.argv.slice(2, 6)).catch((e) => {
  console.dir(e);
  process.exitCode = 100;
  if (e.code === 'CumulusNoLockError') {
    process.exitCode = 101;
  }
  if (!['ConditionalCheckFailedException', 'CumulusLockError'].includes(e.code)) {
    process.exitCode = 1;
  }
});
