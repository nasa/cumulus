import { ECS } from 'aws-sdk';
import { ecs, s3, lambda } from '@cumulus/aws-client/services';
import { EnvironmentVariables } from 'aws-sdk/clients/lambda';
import { AsyncOperationRecord, getKnexClient, tableNames } from '@cumulus/db';
import { v4 as uuidv4 } from 'uuid';
import type { AWSError } from 'aws-sdk/lib/error';
import type { PromiseResult } from 'aws-sdk/lib/request';

import type { AsyncOperationModelClass } from './types';

const { EcsStartTaskError } = require('@cumulus/errors');

export const getLambdaEnvironmentVariables = async (
  functionName: string
): Promise<EnvironmentVariables[]> => {
  const lambdaConfig = await lambda().getFunctionConfiguration({
    FunctionName: functionName,
  }).promise();

  return Object.entries(lambdaConfig?.Environment?.Variables ?? {}).map((obj) => ({
    name: obj[0],
    value: obj[1],
  }));
};

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
 * @param {string} params.useLambdaEnvironmentVariables
 *   Boolean
 * @returns {Promise<Object>}
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#runTask-property
 */
export const startECSTask = async ({
  asyncOperationTaskDefinition,
  cluster,
  lambdaName,
  id,
  payloadBucket,
  payloadKey,
  useLambdaEnvironmentVariables,
  dynamoTableName,
}: {
  asyncOperationTaskDefinition: string,
  cluster: string,
  lambdaName: string,
  id: string,
  payloadBucket: string,
  payloadKey: string,
  useLambdaEnvironmentVariables?: boolean,
  dynamoTableName: string,
}): Promise<PromiseResult<ECS.RunTaskResponse, AWSError>> => {
  const envVars = [
    { name: 'asyncOperationId', value: id },
    { name: 'asyncOperationsTable', value: dynamoTableName },
    { name: 'lambdaName', value: lambdaName },
    { name: 'payloadUrl', value: `s3://${payloadBucket}/${payloadKey}` },
  ] as EnvironmentVariables[];
  let taskVars = envVars;

  if (useLambdaEnvironmentVariables) {
    const lambdaVars = await getLambdaEnvironmentVariables(lambdaName);
    taskVars = envVars.concat(lambdaVars);
  }

  return ecs().runTask({
    cluster,
    taskDefinition: asyncOperationTaskDefinition,
    launchType: 'EC2',
    overrides: {
      containerOverrides: [
        {
          name: 'AsyncOperation',
          environment: taskVars,
        },
      ],
    },
  }).promise();
};

/**
 * Start an AsyncOperation in ECS and store its associate record to DynamoDB
 *
 * @param {Object} params - params
 * @param {string} params.asyncOperationTaskDefinition - the name or ARN of the
 *   async-operation ECS task definition
 * @param {string} params.cluster - the name of the ECS cluster
 * @param {string} params.description - the ECS task description
 * @param {string} params.dynamoTableName - the dynamo async operations table to
 * write records to
 * @param {Object} params.knexConfig - Object with Knex configuration keys
 * @param {string} params.lambdaName - the name of the Lambda task to be run
 * @param {string} params.operationType - the type of async operation to run
 * @param {Object|Array} params.payload - the event to be passed to the lambda task.
 *   Must be a simple Object or Array which can be converted to JSON.
 * @param {string} params.stackName- the Cumulus stack name
 * @param {string} params.systembucket- Cumulus system bucket to use for writing
 * async payload objects
 * @param {string} params.useLambdaEnvironmentVariables -
 * useLambdaEnvironmentVariables, set 'true' if async task
 * should import environment variables from the deployed lambda
 * @param {Class} AsyncOperation - A reference to the AsyncOperations model class
 * @returns {Promise<Object>} - an AsyncOperation record
 * @memberof AsyncOperation
 */
export const startAsyncOperation = async (params: {
  asyncOperationTaskDefinition: string,
  cluster: string,
  description: string,
  dynamoTableName: string,
  knexConfig?: NodeJS.ProcessEnv,
  lambdaName: string,
  operationType: string,
  payload: unknown,
  stackName: string,
  systemBucket: string,
  useLambdaEnvironmentVariables?: boolean,
}, AsyncOperation: AsyncOperationModelClass
): Promise<Partial<AsyncOperationRecord>> => {
  const {
    description,
    operationType,
    payload,
    systemBucket,
    stackName,
    dynamoTableName,
    knexConfig = process.env,
  } = params;

  const id = uuidv4();
  // Store the payload to S3
  const payloadBucket = systemBucket;
  const payloadKey = `${stackName}/async-operation-payloads/${id}.json`;

  await s3().putObject({
    Bucket: payloadBucket,
    Key: payloadKey,
    Body: JSON.stringify(payload),
  }).promise();

  // Start the task in ECS
  const runTaskResponse = await startECSTask({
    ...params,
    id,
    payloadBucket,
    payloadKey,
  });

  if (runTaskResponse?.failures && runTaskResponse.failures.length > 0) {
    throw new EcsStartTaskError(
      `Failed to start AsyncOperation: ${runTaskResponse.failures[0].reason}`
    );
  }

  const asyncOperationModel = new AsyncOperation({
    stackName,
    systemBucket,
    tableName: dynamoTableName,
  });

  const knex = await getKnexClient({ env: knexConfig });
  return knex.transaction(async (trx) => {
    const createObject = {
      id,
      status: 'RUNNING',
      taskArn: runTaskResponse?.tasks?.[0].taskArn,
      description,
      operationType,
    };

    await trx(tableNames.asyncOperations).insert(createObject);
    return asyncOperationModel.create(createObject);
  });
};
