'use strict';

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

  /**
   * Pulls a lock record, checks if sha match
   *
   * @param {string} key - Key
   * @param {string} gitSHA - SHA to check against lock
   * @returns {string} - 'noLock' if no lock present, 'match' if the lock matches,
   *                      else return SHA of lock conflict
   * @memberof Mutex
   */
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

  /**
   * Writes a lockfile entry to dynamodb
   *
   * @param {string} key - stack name to write lock for
   * @param {integer} timeoutMs - lock timeout in ms
   * @param {string} gitSHA - sha to write to lock entry
   * @returns {Promise<Object>} - doc client write result
   * @memberof Mutex
   */
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

  /**
   * Remove lock entry
   *
   * @param {string} key name to unlock
   * @param {string} gitSHA - sha to validate against
   * @returns {Promise<Object>} - returns doc client write result
   * @memberof Mutex
   * @throws {CumulusLockError} - Throws lock error if lock collision occus
   */
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

module.exports = Mutex;
