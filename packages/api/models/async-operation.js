'use strict';

const { ecs, s3, lambda } = require('@cumulus/aws-client/services');
const { EcsStartTaskError } = require('@cumulus/errors');

const uuidv4 = require('uuid/v4');
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
      tableName: params.tableName || process.env.AsyncOperationsTable,
      tableHash: { name: 'id', type: 'S' },
      schema: asyncOperationSchema,
    });

    this.systemBucket = params.systemBucket;
    this.stackName = params.stackName;
  }

  async getLambdaEnvironmentVariables(functionName) {
    const lambdaConfig = await lambda().getFunctionConfiguration({
      FunctionName: functionName,
    }).promise();
    return Object.entries(lambdaConfig.Environment.Variables)
      .map(([name, value]) => ({ name, value }));
  }

  /**
   * Start an ECS task for the async operation.
   *
   * @param {Object} params
   * @param {string} params.asyncOperationTaskDefinition - ARN for the task definition
   * @param {string} params.cluster - ARN for the ECS cluster to use for the task
   * @param {string} params.lambdaName
   *   Environment variable for Lambda name that will be run by the ECS task
   * @param {string} params.id - the Async operation ID
   * @param {string} params.payloadBucket
   *   S3 bucket name where async operation payload is stored
   * @param {string} params.payloadKey
   *   S3 key name where async operation payload is stored
   * @returns {Promise<Object>}
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#runTask-property
   */
  async startECSTask({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    id,
    payloadBucket,
    payloadKey,
    useLambdaEnvironmentVariables,
  }) {
    let envVars = [
      { name: 'asyncOperationId', value: id },
      { name: 'asyncOperationsTable', value: this.tableName },
      { name: 'lambdaName', value: lambdaName },
      { name: 'payloadUrl', value: `s3://${payloadBucket}/${payloadKey}` },
    ];

    if (useLambdaEnvironmentVariables) {
      const lambdaVars = await this.getLambdaEnvironmentVariables(lambdaName);
      envVars = envVars.concat(lambdaVars);
    }

    return ecs().runTask({
      cluster,
      taskDefinition: asyncOperationTaskDefinition,
      launchType: 'EC2',
      overrides: {
        containerOverrides: [
          {
            name: 'AsyncOperation',
            environment: envVars,
          },
        ],
      },
    }).promise();
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
      description,
      operationType,
      payload,
    } = params;

    // Create the record in the database
    const id = uuidv4();

    // Store the payload to S3
    const payloadBucket = this.systemBucket;
    const payloadKey = `${this.stackName}/async-operation-payloads/${id}.json`;

    await s3().putObject({
      Bucket: payloadBucket,
      Key: payloadKey,
      Body: JSON.stringify(payload),
    }).promise();

    // Start the task in ECS
    const runTaskResponse = await this.startECSTask({
      ...params,
      id,
      payloadBucket,
      payloadKey,
    });

    if (runTaskResponse.failures.length > 0) {
      throw new EcsStartTaskError(
        `Failed to start AsyncOperation: ${runTaskResponse.failures[0].reason}`
      );
    }

    // Create the database record with the taskArn
    return this.create({
      id,
      status: 'RUNNING',
      taskArn: runTaskResponse.tasks[0].taskArn,
      description,
      operationType,
    });
  }
}
module.exports = AsyncOperation;
