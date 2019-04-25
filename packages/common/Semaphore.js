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
          key: key,
          semvalue: 0,
          max
        },
        ConditionExpression: '#key <> :key',
        ExpressionAttributeNames: { '#key': 'key' },
        ExpressionAttributeValues: { ':key': key }
      };
      await this.docClient.put(params).promise();
    } catch (e) {
      // If condition fails, then row already exists, which is good and we can continue
      if (e.code !== 'ConditionalCheckFailedException') {
        throw e;
      }
    }
  }

  up(key, max) {
    return this.add(key, 1, max);
  }

  down(key, max) {
    return this.add(key, -1, max);
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
      // If condition fails, then row already exists, which is good and we can continue
      if (e.code !== 'ConditionalCheckFailedException') {
        throw e;
      }
    }

    const updateParams = {
      TableName: this.tableName,
      Key: { key: key },
      UpdateExpression: 'set #semvalue = #semvalue + :val',
      ExpressionAttributeNames: {
        '#semvalue': 'semvalue'
        // '#max': 'max'
      },
      ExpressionAttributeValues: {
        ':val': count
      },
      ReturnValues: 'UPDATED_NEW'
    };

    if (count > 0 && max > 0) {
      updateParams.ExpressionAttributeValues[':max'] = max - count;
      // updateParams.ConditionExpression = '#semvalue <= #max';
    }

    return this.docClient.update(updateParams).promise();
  }
}

module.exports = Semaphore;
