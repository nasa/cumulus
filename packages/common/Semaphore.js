const { ResourcesLockedError } = require('./errors');
const log = require('./log');

class Semaphore {
  constructor(docClient, tableName) {
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async create(key, max) {
    try {
      const params = {
        TableName: this.tableName,
        Item: {
          key,
          semvalue: 0,
          max
        },
        ConditionExpression: '#key <> :key',
        ExpressionAttributeNames: { '#key': 'key' },
        ExpressionAttributeValues: { ':key': key }
      };
      await this.docClient.put(params).promise();
    } catch (e) {
      // Only re-throw errors that are not conditional check failures. A
      // conditional check failure here means that a row tracking the semaphore
      // for this key already exists, which is expected after the first operation.
      if (e.code !== 'ConditionalCheckFailedException') {
        throw e;
      }
    }
  }

  up(key) {
    return this.add(key, 1);
  }

  down(key) {
    return this.add(key, -1);
  }

  async checkout(key, count, fn) {
    let result = null;
    log.info(`Incrementing ${key} by ${count}`);
    try {
      await this.add(key, count);
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

  async add(key, count) {
    const getParams = {
      TableName: this.tableName,
      Key: {
        key
      }
    };
    const getResponse = await this.docClient.get(getParams).promise();
    if (!getResponse.Item) {
      throw new Error(`Semaphore ${key} does not exist`);
    }

    const updateParams = {
      TableName: this.tableName,
      Key: {
        key
      },
      UpdateExpression: 'set #semvalue = #semvalue + :val',
      ExpressionAttributeNames: {
        '#semvalue': 'semvalue',
        '#max': 'max'
      },
      ExpressionAttributeValues: {
        ':val': count
      },
      ReturnValues: 'UPDATED_NEW',
      ConditionExpression: '#semvalue < #max'
    };

    return this.docClient.update(updateParams).promise();
  }
}

module.exports = Semaphore;
