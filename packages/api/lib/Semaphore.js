const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const {
  isConditionalCheckException,
  ResourcesLockedError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: 'api/Semaphore' });

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
          semvalue: 0,
        },
        ConditionExpression: '#key <> :key',
        ExpressionAttributeNames: { '#key': 'key' },
        ExpressionAttributeValues: { ':key': key },
      };
      await this.docClient.put(params);
    } catch (error) {
      // Only re-throw errors that are not conditional check failures. A
      // conditional check failure here means that a row tracking the semaphore
      // for this key already exists, which is expected after the first operation.
      if (!isConditionalCheckException(error)) {
        throw error;
      }
    }
  }

  get(key) {
    return DynamoDb.get({
      tableName: this.tableName,
      item: {
        key,
      },
      client: this.docClient,
    });
  }

  scan() {
    return DynamoDb.scan({
      tableName: this.tableName,
    });
  }

  up(key, maximum) {
    return this.add(key, 1, maximum);
  }

  down(key) {
    return this.add(key, -1);
  }

  async checkout(key, count, max, fn) {
    let result;
    log.info(`Incrementing ${key} by ${count}`);
    await this.add(key, count, max);
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
        key,
      },
      UpdateExpression: 'set #semvalue = #semvalue + :val',
      ExpressionAttributeNames: {
        '#semvalue': 'semvalue',
      },
      ExpressionAttributeValues: {
        ':val': count,
      },
      ReturnValues: 'UPDATED_NEW',
    };

    if (count > 0 && max >= 0) {
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
      // Semaphore value should not go below 0. If this operation is
      // decrementing the semaphore value, ensure that the current
      // semaphore value is large enough to not go below 0 after
      // the decrement operation.
      const effectiveMin = 0 - count;
      updateParams.ExpressionAttributeValues[':min'] = effectiveMin;
      updateParams.ConditionExpression = '#semvalue >= :min';
    }

    try {
      await this.docClient.update(updateParams);
    } catch (error) {
      // If count > 0 and this is a conditional check exception, then the
      // operation failed because it would have exceeded the maximum, so
      // throw a ResourcesLockedError.
      //
      // A conditional check exception where count < 0 is simply an invalid
      // operation attempting to decrement the semaphore count below 0 and
      // is symptomatic of a bug elsewhere attempting to decrement
      // semaphores before they have been created/incremented.
      if (count > 0 && isConditionalCheckException(error)) {
        throw new ResourcesLockedError(`Could not add ${count} to key ${key}`);
      }
      log.error(error.message, error.stack);
      throw error;
    }
  }
}

module.exports = Semaphore;
