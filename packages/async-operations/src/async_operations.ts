import { ECS } from 'aws-sdk';
import { ecs, s3, lambda } from '@cumulus/aws-client/services';
import { EnvironmentVariables } from 'aws-sdk/clients/lambda';
import {
  getKnexClient,
  translateApiAsyncOperationToPostgresAsyncOperation,
  AsyncOperationPgModel,
  createRejectableTransaction,
} from '@cumulus/db';
import { ApiAsyncOperation, AsyncOperationType } from '@cumulus/types/api/async_operations';
import { v4 as uuidv4 } from 'uuid';
import type { AWSError } from 'aws-sdk/lib/error';
import type { PromiseResult } from 'aws-sdk/lib/request';

import type {
  AsyncOperationModelClass,
  AsyncOperationPgModelObject,
} from './types';

const { EcsStartTaskError } = require('@cumulus/errors');
const {
  indexAsyncOperation,
} = require('@cumulus/es-client/indexer');
const {
  Search,
} = require('@cumulus/es-client/search');

type StartEcsTaskReturnType = Promise<PromiseResult<ECS.RunTaskResponse, AWSError>>;

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
}): StartEcsTaskReturnType => {
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

export const createAsyncOperation = async (
  params: {
    createObject: ApiAsyncOperation,
    stackName: string,
    systemBucket: string,
    dynamoTableName: string,
    knexConfig?: NodeJS.ProcessEnv,
    esClient?: object,
    asyncOperationPgModel?: AsyncOperationPgModelObject
  },
  AsyncOperation: AsyncOperationModelClass
): Promise<Partial<ApiAsyncOperation>> => {
  const {
    createObject,
    stackName,
    systemBucket,
    dynamoTableName,
    knexConfig = process.env,
    esClient = await Search.es(),
    asyncOperationPgModel = new AsyncOperationPgModel(),
  } = params;

  const asyncOperationModel = new AsyncOperation({
    stackName,
    systemBucket,
    tableName: dynamoTableName,
  });

  const knex = await getKnexClient({ env: knexConfig });
  let createdAsyncOperation: ApiAsyncOperation | undefined;

  try {
    return await createRejectableTransaction(knex, async (trx) => {
      const pgCreateObject = translateApiAsyncOperationToPostgresAsyncOperation(createObject);
      await asyncOperationPgModel.create(trx, pgCreateObject);
      createdAsyncOperation = await asyncOperationModel.create(createObject);
      await indexAsyncOperation(esClient, createObject, process.env.ES_INDEX);
      return createdAsyncOperation;
    });
  } catch (error) {
    if (createdAsyncOperation) {
      await asyncOperationModel.delete({ id: createdAsyncOperation.id });
    }
    throw error;
  }
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
export const startAsyncOperation = async (
  params: {
    asyncOperationTaskDefinition: string,
    cluster: string,
    description: string,
    dynamoTableName: string,
    knexConfig?: NodeJS.ProcessEnv,
    lambdaName: string,
    operationType: AsyncOperationType,
    payload: unknown,
    stackName: string,
    systemBucket: string,
    useLambdaEnvironmentVariables?: boolean,
    startEcsTaskFunc?: () => StartEcsTaskReturnType
  },
  AsyncOperation: AsyncOperationModelClass
): Promise<Partial<ApiAsyncOperation>> => {
  const {
    description,
    operationType,
    payload,
    systemBucket,
    stackName,
    dynamoTableName,
    knexConfig,
    startEcsTaskFunc = startECSTask,
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
  const runTaskResponse = await startEcsTaskFunc({
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

  return createAsyncOperation(
    {
      createObject: {
        id,
        status: 'RUNNING',
        taskArn: runTaskResponse?.tasks?.[0].taskArn,
        description,
        operationType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      stackName,
      systemBucket,
      dynamoTableName,
      knexConfig,
    },
    AsyncOperation
  );
};
