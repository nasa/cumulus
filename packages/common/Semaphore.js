const { ResourcesLockedError } = require('./errors');
const log = require('./log');

class Semaphore {
  constructor(docClient, tableName) {
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async create(key) {
    try {
      const params = {
        TableName: this.tableName,
        Item: {
          key,
          semvalue: 0
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

  get(key) {
    return this.docClient.get({
      TableName: this.tableName,
      Key: {
        key
      }
    }).promise();
  }

  scan() {
    return this.docClient.scan({
      TableName: this.tableName
    }).promise();
  }

  up(key, maximum) {
    return this.add(key, 1, maximum);
  }

  down(key, maximum) {
    return this.add(key, -1, maximum);
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

  async add(key, count, max) {
    // Create the semaphore if it doesn't exist.
    await this.create(key);

    const updateParams = {
      TableName: this.tableName,
      Key: {
        key
      },
      UpdateExpression: 'set #semvalue = #semvalue + :val',
      ExpressionAttributeNames: {
        '#semvalue': 'semvalue'
      },
      ExpressionAttributeValues: {
        ':val': count
      },
      ReturnValues: 'UPDATED_NEW'
    };

    if (count >= 0 && max >= 0) {
      // Determine the effective maximum for this operation and prevent
      // semaphore value from exceeding overall maximum.
      //
      // If we are incrementing the semaphore by 1 and the maximum is 1,
      // then the effective maximum for this operation is that the semaphore
      // value should not already exceed 0 (1 - 1 = 0). If it does already
      // exceed 0, then incrementing the semaphore by one would exceed the
      // maximum (1 + 1 > 1);
      const effectiveMax = max - count;
      updateParams.ExpressionAttributeValues[':max'] = effectiveMax;
      updateParams.ConditionExpression = '#semvalue <= :max';
    } else if (count < 0) {
      // Semaphore value should not go below 0. if this operation is
      // decrementing the semaphore value, ensure that the current
      // semaphore value is large enough to not go below 0 after
      // the decrement operation.
      const effectiveMin = 0 - count;
      updateParams.ExpressionAttributeValues[':min'] = effectiveMin;
      updateParams.ConditionExpression = '#semvalue >= :min';
    }

    return this.docClient.update(updateParams).promise();
  }
}

module.exports = Semaphore;
