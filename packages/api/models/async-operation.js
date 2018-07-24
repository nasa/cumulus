'use strict';

const { ecs, s3, s3Join } = require('@cumulus/common/aws');
const uuidv4 = require('uuid/v4');
const Manager = require('./base');
const { asyncOperations: asyncOperationsSchema } = require('./schemas');

class AsyncOperation extends Manager {
  constructor(params) {
    if (!params.stackName) throw new TypeError('stackName is required');
    if (!params.systemBucket) throw new TypeError('systemBucket is required');

    super({
      tableName: params.tableName,
      tableHash: { name: 'id', type: 'S' },
      tableSchema: asyncOperationsSchema
    });

    this.systemBucket = params.systemBucket;
    this.stackName = params.stackName;
  }

  get(id) {
    return super.get({ id });
  }

  async start(params) {
    const {
      cluster,
      asyncOperationTaskDefinition,
      lambdaName,
      payload
    } = params;

    const id = uuidv4();

    // Upload payload to S3
    const payloadKey = s3Join(this.stackName, 'async-operation-payloads', `${id}.json`);

    await s3().putObject({
      Bucket: this.systemBucket,
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
              { name: 'payloadUrl', value: `s3://${this.systemBucket}/${payloadKey}` }
            ]
          }
        ]
      }
    }).promise();

    if (runTaskResponse.failures.length > 0) {
      console.log('runTaskResponse.failures:', JSON.stringify(runTaskResponse, null, 2));
      throw new Error(`Failed to start AsyncOperation: ${runTaskResponse.failures[0].reason}`);
    }

    const taskArn = runTaskResponse.tasks[0].taskArn;

    return this.create({
      id,
      taskArn,
      status: 'CREATED'
    });
  }
}
module.exports = AsyncOperation;
