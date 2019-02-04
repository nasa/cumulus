'use strict';

const { ecs, s3 } = require('@cumulus/common/aws');
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
   * Start an AsyncOperation in ECS and store its associate record to DynamoDB
   *
   * @param {Object} params - params
   * @param {string} params.id - the id of the AsyncOperation to start
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

    // Create the record in the database
    const id = uuidv4();
    await this.create({ id, status: 'RUNNING' });

    // Store the payload to S3
    const payloadBucket = this.systemBucket;
    const payloadKey = `${this.stackName}/async-operation-payloads/${id}.json`;

    await s3().putObject({
      Bucket: payloadBucket,
      Key: payloadKey,
      Body: JSON.stringify(payload)
    }).promise();

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
              { name: 'payloadUrl', value: `s3://${payloadBucket}/${payloadKey}` }
            ]
          }
        ]
      }
    }).promise();

    // If creating the stack failed, update the database
    if (runTaskResponse.failures.length > 0) {
      return this.update(
        { id },
        {
          status: 'RUNNER_FAILED',
          output: JSON.stringify({
            name: 'EcsStartTaskError',
            message: `Failed to start AsyncOperation: ${runTaskResponse.failures[0].reason}`,
            stack: (new Error()).stack
          })
        }
      );
    }

    // Update the database with the taskArn
    return this.update(
      { id },
      {
        status: 'RUNNING',
        taskArn: runTaskResponse.tasks[0].taskArn
      }
    );
  }
}
module.exports = AsyncOperation;
