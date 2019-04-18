'use strict';

const compact = require('lodash.compact');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;
const url = require('url');
const pLimit = require('p-limit');
const log = require('./log');
const ResourcesLockedError = require('./errors').ResourcesLockedError;

/**
 * Wrap a function to limit how many instances can be run in parallel
 *
 * While this function works, odds are that you should be using
 * [p-map](https://www.npmjs.com/package/p-map) instead.
 *
 * @param {integer} n - the concurrency limit
 * @param {Function} fn - the function to limit
 * @returns {Function} a version of `fn` that limits concurrency
 */
const limit = (n, fn) => pLimit(n).bind(null, fn);

const mapTolerant = (arr, fn) => {
  const errors = [];
  const tolerate = (item, reason) => {
    if (reason.stack) {
      log.error(reason.stack);
    }
    errors.push({ item: item, reason: reason });
    return null;
  };

  const tolerantCall = (item) =>
    Promise.resolve(fn(item))
      .catch((err) => tolerate(item, err));

  return Promise.all(arr.map(tolerantCall))
    .then((items) => { //eslint-disable-line arrow-body-style
      return {
        completed: compact(items),
        errors: errors.length === 0 ? null : errors
      };
    });
};

const toPromise = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (err, data) => (err ? reject(err) : resolve(data))));

/**
 * Returns a promise that resolves to the result of calling the given function if
 * condition returns false or null if condition is true. Useful for chaining.
 *
 * @param {function} condition - A function which determines whether fn is called.
 * @param {function} fn - The function to call if condition returns true
 * @param {*} args - Arguments to pass to calls to both condition and fn
 * @returns {Promise<*>} - A promise that resolves to either null or the result of fn
*/
const unless = (condition, fn, ...args) =>
  Promise.resolve((condition(...args) ? null : fn(...args)));

const promiseUrl = (urlstr) =>
  new Promise((resolve, reject) => {
    const client = urlstr.startsWith('https') ? https : http;
    const urlopts = url.parse(urlstr);
    const options = {
      hostname: urlopts.hostname,
      port: urlopts.port,
      path: urlopts.path,
      auth: urlopts.auth,
      headers: { 'User-Agent': 'Cumulus-GIBS' }
    };
    return client.get(options, (response) => {
      if (response.statusCode >= 300) {
        reject(new Error(`HTTP Error ${response.statusCode}`));
      } else {
        resolve(response);
      }
    }).on('error', reject);
  });

class Semaphore {
  constructor(docClient, tableName) {
    this.docClient = docClient;
    this.tableName = tableName;
  }

  up(key) {
    return this.add(key, 1);
  }

  down(key) {
    return this.add(key, -1);
  }

  async checkout(key, count, max, fn) {
    let result = null;
    log.info(`Incrementing ${key} by ${count}`);
    try {
      await this.add(key, count, max);
    } catch (e) {
      if (e.message === 'The conditional request failed') {
        throw new ResourcesLockedError(`Could not increment ${key} by ${count}`);
      }
      log.error(e.message, e.stack);
      throw e;
    }
    try {
      result = await fn();
    } finally {
      log.info(`Decrementing ${key} by ${count}`);
      await this.add(key, -count);
    }
    return result;
  }

  async add(key, count, max = 0) {
    try {
      const params = {
        TableName: this.tableName,
        Item: {
          key: key,
          semvalue: 0
        },
        ConditionExpression: '#key <> :key',
        ExpressionAttributeNames: { '#key': 'key' },
        ExpressionAttributeValues: { ':key': key }
      };
      await this.docClient.put(params).promise();
    } catch (e) {
      if (e.code !== 'ConditionalCheckFailedException') {
        throw e;
      }
    }

    const updateParams = {
      TableName: this.tableName,
      Key: { key: key },
      UpdateExpression: 'set semvalue = semvalue + :val',
      ExpressionAttributeValues: { ':val': count },
      ReturnValues: 'UPDATED_NEW'
    };

    if (count > 0 && max > 0) {
      updateParams.ExpressionAttributeValues[':max'] = max - count;
      updateParams.ConditionExpression = 'semvalue <= :max';
    }
    return this.docClient.update(updateParams).promise();
  }
}

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

module.exports = {
  Mutex: Mutex,
  Semaphore: Semaphore,
  limit: limit,
  mapTolerant: mapTolerant,
  promiseUrl: promiseUrl,
  toPromise: toPromise,
  unless: unless
};
