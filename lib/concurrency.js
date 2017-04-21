'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const TaskQueue = require('cwait').TaskQueue;
const _ = require('lodash');
const log = require('./log');

const limit = (n, fn) => new TaskQueue(Promise, n).wrap(fn);

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
         completed: _.compact(items),
         errors: errors.length === 0 ? null : errors
       };
     });
};

const toPromise = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (err, data) => (err ? reject(err) : resolve(data))));

const unless = (condition, fn, ...args) =>
  (condition(...args) ? null : fn(...args));


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
    client.get(options, (response) => {
      if (response.statusCode >= 300) {
        reject(`HTTP Error ${response.statusCode}`);
      }
      else {
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

  async checkout(key, count, max, fn, fail = () => null) {
    let result = null;
    log.info(`Incrementing ${key} by ${count}`);
    try {
      await this.add(key, count, max);
    }
    catch (e) {
      if (e.message !== 'The conditional request failed') {
        log.error(e.message, e.stack);
        throw e;
      }
      return fail();
    }
    try {
      result = await fn();
    }
    finally {
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
    }
    catch (e) {
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
    }
    finally {
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
