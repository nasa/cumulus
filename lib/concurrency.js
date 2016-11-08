'use strict';

const http = require('http');
const https = require('https');
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


const promiseUrl = (url) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (response) => {
      if (response.statusCode >= 300) {
        reject(`HTTP Error ${response.statusCode}`);
      }
      else {
        resolve(response);
      }
    }).on('error', reject);
  });


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
  limit: limit,
  mapTolerant: mapTolerant,
  promiseUrl: promiseUrl,
  toPromise: toPromise,
  unless: unless
};
