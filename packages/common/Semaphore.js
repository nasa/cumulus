const aws = require('./aws');
const ResourcesLockedError = require('./errors').ResourcesLockedError;

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
      debugger;
      await aws.improveStackTrace(this.docClient.put(params).promise());
    } catch (e) {
      debugger;
      if (e.code !== 'ConditionalCheckFailedException') {
        throw e;
      }
    }

    const updateParams = {
      TableName: this.tableName,
      Key: { key: key },
      UpdateExpression: 'set #semvalue = if_not_exists(#semvalue, :zero) + :val',
      ExpressionAttributeNames: {
        '#semvalue': 'semvalue'
      },
      ExpressionAttributeValues: {
        ':val': count,
        ':zero': 0
      },
      ReturnValues: 'UPDATED_NEW'
    };

    if (count > 0 && max > 0) {
      updateParams.ExpressionAttributeValues[':max'] = max - count;
      updateParams.ConditionExpression = '#semvalue <= :max';
    }
    debugger;
    return this.docClient.update(updateParams).promise();
  }
}

module.exports = Semaphore;
