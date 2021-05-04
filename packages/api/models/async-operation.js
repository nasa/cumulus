'use strict';

const Manager = require('./base');
const { asyncOperation: asyncOperationSchema } = require('./schemas');

/**
 * A class for tracking AsyncOperations using DynamoDB.
 *
 * @class AsyncOperation
 * @augments {Manager}
 */
class AsyncOperation extends Manager {
  /**
   * Creates an instance of AsyncOperation.
   *
   * @param {Object} params              - params
   * @param {string} params.stackName    - the Cumulus stack name
   * @param {string} params.systemBucket - the name of the Cumulus system bucket
   * @param {string} params.tableName    - the name of the AsyncOperation DynamoDB
   * @returns {undefined} creates a new AsyncOperation object
   * @memberof AsyncOperation
   */
  constructor(params) {
    if (!params.stackName) throw new TypeError('stackName is required');
    if (!params.systemBucket) throw new TypeError('systemBucket is required');

    super({
      tableName: params.tableName || process.env.AsyncOperationsTable,
      tableHash: { name: 'id', type: 'S' },
      schema: asyncOperationSchema,
    });

    this.systemBucket = params.systemBucket;
    this.stackName = params.stackName;

    this.dynamoDbClient = new Manager({
      tableName: params.tableName || process.env.AsyncOperationsTable,
      tableHash: { name: 'id', type: 'S' },
      schema: asyncOperationSchema,
    });
  }

  async getAllAsyncOperations() {
    return this.dynamoDbClient.scan({
      names: {
        '#id': 'id',
      },
    },
    '#id').then((result) => result.Items);
  }
}
module.exports = AsyncOperation;
