'use strict';

const { ecs, s3, s3Join } = require('@cumulus/common/aws');
const uuidv4 = require('uuid/v4');
const Manager = require('./base');
const { asyncOperation: asyncOperationSchema } = require('./schemas');

/**
 * A class for tracking AsyncOperations using DynamoDB.
 *
 * @class AsyncOperation
 * @extends {Manager}
 */
class AsyncOperation extends Manager {
  /**
   * Creates an instance of AsyncOperation.
   *
   * @param {Object} params - params
   * @param {string} params.stackName - the Cumulus stack name
   * @param {string} params.systemBucket - the name of the Cumulus system bucket
   * @param {string} params.tableName - the name of the AsyncOperation DynamoDB
   *   table
   * @returns {undefined} creates a new AsyncOperation object
   * @memberof AsyncOperation
   */
  constructor(params) {
    if (!params.stackName) throw new TypeError('stackName is required');
    if (!params.systemBucket) throw new TypeError('systemBucket is required');

    super({
      tableName: params.tableName,
      tableHash: { name: 'id', type: 'S' },
      schema: asyncOperationSchema
    });

    this.systemBucket = params.systemBucket;
    this.stackName = params.stackName;
  }

  /**
   * Fetch the AsyncOperation with the given id
   *
   * @param {string} id - an AsyncOperation id
   * @returns {Promise<Object>} - an AsyncOperation record
   * @memberof AsyncOperation
   */
  get(id) {
    return super.get({ id });
  }

  /**
   * Update an AsyncOperation in the database
   *
   * @param {string} id - the ID of the AsyncOperation
   * @param {Object} updates - key / value pairs of fields to be updated
   * @param {Array<string>} keysToDelete - an optional list of keys to remove
   *   from the object
   * @returns {Promise<Object>} - a Promise that resolves to the object after it
   *   is updated
   * @memberof AsyncOperation
   */
  update(id, updates = {}, keysToDelete = []) {
    return super.update({ id }, updates, keysToDelete);
  }

  /**
   * Start an AsyncOperation in ECS and store its associate record to DynamoDB
   *
   * @param {Object} params - params
   * @param {string} params.asyncOperationTaskDefinition - the name or ARN of the
   *   async-operation ECS task definition
   * @param {string} params.cluster - the name of the ECS cluster
   * @param {string} params.lambdaName - the name of the Lambda task to be run
   * @param {Object|Array} params.payload - the event to be passed to the lambda task.
   *   Must be a simple Object or Array which can be converted to JSON.
   * @returns {Promise<Object>} - an AsyncOperation record
   * @memberof AsyncOperation
   */
  async start(params) {
    const {
      asyncOperationTaskDefinition,
      cluster,
      lambdaName,
      payload
    } = params;

    // Generate the ID of the AsyncOperation
    const id = uuidv4();

    // Upload payload to S3
    const payloadKey = s3Join(this.stackName, 'async-operation-payloads', `${id}.json`);

    await s3().putObject({
      Bucket: this.systemBucket,
      Key: payloadKey,
      Body: JSON.stringify(payload)
    }).promise();

    // Create the item in the database
    await this.create({ id, status: 'CREATING' });

    // Start the task in ECS
    const runTaskResponse = await ecs().runTask({
      cluster,
      taskDefinition: asyncOperationTaskDefinition,
      launchType: 'EC2',
      overrides: {
        containerOverrides: [
          {
            name: 'AsyncOperation',
            environment: [
              { name: 'asyncOperationId', value: id },
              { name: 'asyncOperationsTable', value: this.tableName },
              { name: 'lambdaName', value: lambdaName },
              { name: 'payloadUrl', value: `s3://${this.systemBucket}/${payloadKey}` }
            ]
          }
        ]
      }
    }).promise();

    if (runTaskResponse.failures.length > 0) {
      const err = new Error(runTaskResponse.failures[0].reason);
      err.name = 'EcsStartTaskError';
      throw err;
    }

    return this.update(
      id,
      { taskArn: runTaskResponse.tasks[0].taskArn }
    );
  }
}
module.exports = AsyncOperation;
