import { ECS } from 'aws-sdk';
import { Knex } from 'knex';
import { FunctionConfiguration } from '@aws-sdk/client-lambda';
import { ecs, s3, lambda } from '@cumulus/aws-client/services';

import {
  getKnexClient,
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
  AsyncOperationPgModel,
  createRejectableTransaction,
} from '@cumulus/db';
import Logger from '@cumulus/logger';
import { ApiAsyncOperation, AsyncOperationType } from '@cumulus/types/api/async_operations';
import { v4 as uuidv4 } from 'uuid';
import type { AWSError } from 'aws-sdk/lib/error';
import type { PromiseResult } from 'aws-sdk/lib/request';

import type {
  AsyncOperationPgModelObject,
} from './types';

const { EcsStartTaskError, MissingRequiredArgument } = require('@cumulus/errors');
const {
  indexAsyncOperation,
} = require('@cumulus/es-client/indexer');
const {
  Search,
} = require('@cumulus/es-client/search');

const logger = new Logger({ sender: '@cumulus/async-operation' });

type StartEcsTaskReturnType = Promise<PromiseResult<ECS.RunTaskResponse, AWSError>>;

export const getLambdaConfiguration = async (
  functionName: string
): Promise<FunctionConfiguration> => lambda().getFunctionConfiguration({
  FunctionName: functionName,
});

export const getLambdaEnvironmentVariables = (
  configuration: FunctionConfiguration
): Record<string, string>[] => Object.entries(configuration?.Environment?.Variables ?? {}).map(
  (obj) => ({
    name: obj[0],
    value: obj[1],
  })
);

/**
 * Start an ECS task for the async operation.
 *
 * @param {Object} params
 * @param {string} params.asyncOperationTaskDefinition - ARN for the task definition
 * @param {string} params.cluster - ARN for the ECS cluster to use for the task
 * @param {string} params.callerLambdaName
 *   Environment variable for Lambda name that is initiating the ECS task
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
  callerLambdaName,
  lambdaName,
  id,
  payloadBucket,
  payloadKey,
  useLambdaEnvironmentVariables,
}: {
  asyncOperationTaskDefinition: string,
  cluster: string,
  callerLambdaName: string,
  lambdaName: string,
  id: string,
  payloadBucket: string,
  payloadKey: string,
  useLambdaEnvironmentVariables?: boolean,
}): StartEcsTaskReturnType => {
  const envVars = [
    { name: 'asyncOperationId', value: id },
    { name: 'lambdaName', value: lambdaName },
    { name: 'payloadUrl', value: `s3://${payloadBucket}/${payloadKey}` },
  ] as Record<string, string>[];
  let taskVars = envVars;

  const callerLambdaConfig = await getLambdaConfiguration(callerLambdaName);

  if (useLambdaEnvironmentVariables) {
    const lambdaConfig = await getLambdaConfiguration(lambdaName);
    const lambdaVars = getLambdaEnvironmentVariables(lambdaConfig);
    taskVars = envVars.concat(lambdaVars);
  }

  return ecs().runTask({
    cluster,
    taskDefinition: asyncOperationTaskDefinition,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: callerLambdaConfig?.VpcConfig?.SubnetIds ?? [],
        assignPublicIp: 'DISABLED',
        securityGroups: callerLambdaConfig?.VpcConfig?.SecurityGroupIds ?? [],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: 'AsyncOperation',
          environment: taskVars,
        },
      ],
    },
  });
};

export const createAsyncOperation = async (
  params: {
    createObject: ApiAsyncOperation,
    stackName: string,
    systemBucket: string,
    knexConfig?: NodeJS.ProcessEnv,
    esClient?: object,
    asyncOperationPgModel?: AsyncOperationPgModelObject
  }
): Promise<Partial<ApiAsyncOperation>> => {
  const {
    createObject,
    stackName,
    systemBucket,
    knexConfig = process.env,
    esClient = await Search.es(),
    asyncOperationPgModel = new AsyncOperationPgModel(),
  } = params;

  if (!stackName) throw new TypeError('stackName is required');
  if (!systemBucket) throw new TypeError('systemBucket is required');

  const knex = await getKnexClient({ env: knexConfig });
  return await createRejectableTransaction(knex, async (trx: Knex.Transaction) => {
    const pgCreateObject = translateApiAsyncOperationToPostgresAsyncOperation(createObject);
    const pgRecord = await asyncOperationPgModel.create(trx, pgCreateObject, ['*']);
    const apiRecord = translatePostgresAsyncOperationToApiAsyncOperation(pgRecord[0]);
    await indexAsyncOperation(esClient, apiRecord, process.env.ES_INDEX);

    return apiRecord;
  });
};

/**
 * Start an AsyncOperation in ECS and store its associate record to DynamoDB
 *
 * @param {Object} params - params
 * @param {string} params.asyncOperationTaskDefinition - the name or ARN of the
 *   async-operation ECS task definition
 * @param {string} params.cluster - the name of the ECS cluster
 * @param {string} params.description - the ECS task description
 * @param {Object} params.knexConfig - Object with Knex configuration keys
 * @param {string} params.callerLambdaName - the name of the Lambda initiating the ECS task
 * @param {string} params.lambdaName - the name of the Lambda task to be run
 * @param {string} params.operationType - the type of async operation to run
 * @param {Object|Array} params.payload - the event to be passed to the lambda task.
 *   Must be a simple Object or Array which can be converted to JSON.
 * @param {string} params.stackName - the Cumulus stack name
 * @param {string} params.systemBucket - Cumulus system bucket to use for writing
 * async payload objects
 * @param {string} params.useLambdaEnvironmentVariables -
 * useLambdaEnvironmentVariables, set 'true' if async task
 * should import environment variables from the deployed lambda
 * @param {Object} params.startEcsTaskFunc - used for testing
 * @returns {Promise<Object>} - an AsyncOperation record
 * @memberof AsyncOperation
 */
export const startAsyncOperation = async (
  params: {
    asyncOperationId?: string,
    asyncOperationTaskDefinition: string,
    cluster: string,
    description: string,
    knexConfig?: NodeJS.ProcessEnv,
    callerLambdaName: string,
    lambdaName: string,
    operationType: AsyncOperationType,
    payload: unknown,
    stackName: string,
    systemBucket: string,
    useLambdaEnvironmentVariables?: boolean,
    startEcsTaskFunc?: () => StartEcsTaskReturnType
  }
): Promise<Partial<ApiAsyncOperation>> => {
  const {
    description,
    operationType,
    payload,
    systemBucket,
    stackName,
    callerLambdaName,
    knexConfig = process.env,
    startEcsTaskFunc = startECSTask,
  } = params;

  if (!callerLambdaName) {
    throw new MissingRequiredArgument(`callerLambdaName must be specified to start new async operation, received: ${callerLambdaName}`);
  }

  const id = params.asyncOperationId ?? uuidv4();
  // Store the payload to S3
  const payloadBucket = systemBucket;
  const payloadKey = `${stackName}/async-operation-payloads/${id}.json`;

  await s3().putObject({
    Bucket: payloadBucket,
    Key: payloadKey,
    Body: JSON.stringify(payload),
  });

  logger.debug(`About to start AsyncOperation: ${id}`);
  let runTaskResponse;
  try {
    runTaskResponse = await startEcsTaskFunc({
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
  } catch (error) {
    logger.error(`Failed to start AsyncOperation ${id}`, error);
    const output = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    await createAsyncOperation(
      {
        createObject: {
          id,
          status: 'RUNNER_FAILED',
          output: JSON.stringify(output),
          description,
          operationType,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        stackName,
        systemBucket,
        knexConfig,
      }
    );
    throw error;
  }

  logger.debug(`About to create AsyncOperation record: ${id}`);
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
      knexConfig,
    }
  );
};
