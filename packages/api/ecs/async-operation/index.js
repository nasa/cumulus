/* eslint no-console: "off" */

'use strict';

const got = require('got');
const pRetry = require('p-retry');
const util = require('util');
const isError = require('lodash/isError');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const url = require('url');
const Logger = require('@cumulus/logger');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { GetFunctionCommand } = require('@aws-sdk/client-lambda');

const { lambda, s3 } = require('@cumulus/aws-client/services');
const {
  deleteS3Object,
  getObject,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  getKnexClient,
  AsyncOperationPgModel,
  createRejectableTransaction,
  translatePostgresAsyncOperationToApiAsyncOperation,
} = require('@cumulus/db');

const logger = new Logger({ sender: 'ecs/async-operation' });

const requiredEnvironmentalVariables = [
  'asyncOperationId',
  'lambdaName',
  'payloadUrl',
];

/**
 * Return a list of environment variables that should be set but aren't
 *
 * @returns {Array<string>} a list of missing environment variables
 */
function missingEnvironmentVariables() {
  return requiredEnvironmentalVariables.filter((key) => process.env[key] === undefined);
}

/**
 * Fetch an object from S3 and parse it as JSON
 *
 * @param {string} Bucket - the S3 bucket
 * @param {string} Key - the S3 key
 * @returns {Object|Array} the parsed payload
 */
async function fetchPayload(Bucket, Key) {
  let payloadResponse;
  try {
    payloadResponse = await getObject(s3(), { Bucket, Key });
  } catch (error) {
    throw new Error(`Failed to fetch s3://${Bucket}/${Key}: ${error.message}`);
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(await getObjectStreamContents(payloadResponse.Body));
  } catch (error) {
    if (error.name !== 'SyntaxError') throw error;
    const newError = new Error(`Unable to parse payload: ${error.message}`);
    newError.name = 'JSONParsingError';
    throw newError;
  }

  return parsedPayload;
}

/**
 * Fetch and delete a lambda payload from S3
 *
 * @param {string} payloadUrl - the s3:// URL of the payload
 * @returns {Promise<Object>} a payload that can be passed as the event of a lambda call
 */
async function fetchAndDeletePayload(payloadUrl) {
  const parsedPayloadUrl = url.parse(payloadUrl);
  const Bucket = parsedPayloadUrl.hostname;
  const Key = parsedPayloadUrl.path.substring(1);

  const payload = await fetchPayload(Bucket, Key);

  await deleteS3Object(Bucket, Key);

  return payload;
}

/**
 * Query AWS for the codeUrl, moduleFileName, and moduleFunctionName of a
 *   Lambda function.
 *
 * @param {string} FunctionName - the name of the Lambda function
 * @returns {Promise<Object>} an object with the codeUrl, moduleFileName, and
 *   moduleFunctionName
 */
async function getLambdaInfo(FunctionName) {
  logger.debug(`Retrieving lambda info for ${FunctionName}.`);

  const getFunctionResponse = await lambda().send(new GetFunctionCommand({
    FunctionName,
  }));

  const handler = getFunctionResponse.Configuration.Handler;
  const [moduleFileName, moduleFunctionName] = handler.split('.');

  return {
    moduleFileName,
    moduleFunctionName,
    codeUrl: getFunctionResponse.Code.Location,
  };
}

/**
 * Download a lambda function from AWS and extract it to the
 *   /home/task/lambda-function directory
 *
 * @param {string} codeUrl - an https URL to download the lambda code from
 * @returns {Promise<undefined>} resolves when the code has been downloaded
 */
async function fetchLambdaFunction(codeUrl) {
  // Fetching the lambda zip file from S3 was failing intermittently because
  // of connection timeouts.  If the download fails, this will retry it up to
  // 10 times with an exponential backoff.
  logger.debug(`Fetching lambda code from ${codeUrl}.`);
  await pRetry(
    () => promisify(pipeline)(
      got.stream(codeUrl),
      fs.createWriteStream('/home/task/fn.zip')
    ),
    {
      maxTimeout: 10000,
      onFailedAttempt: (err) => {
        const message = (err.attemptsLeft > 0)
          ? `Failed to download lambda function (will retry): ${err}`
          : `Failed to download lambda function (will not retry): ${err}`;
        logger.error(message);
      },
    }
  );
  logger.debug('Lambda downloaded, unzipping.');
  return exec('unzip -o /home/task/fn.zip -d /home/task/lambda-function');
}

/**
 * Given an Error object return an object to be stored as the AsyncOperation
 *   output.
 *
 * @param {Error} error - the error to be stored
 * @returns {Object} an object with name, message, and stack properties
 */
function buildErrorOutput(error) {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

const writeAsyncOperationToPostgres = async (params) => {
  const {
    trx,
    env,
    dbOutput,
    status,
    updatedTime,
    asyncOperationPgModel,
  } = params;
  const id = env.asyncOperationId;
  return await asyncOperationPgModel
    .update(
      trx,
      { id },
      {
        status,
        output: dbOutput,
        updated_at: new Date(Number(updatedTime)),
      },
      ['*']
    );
};

const writeAsyncOperationToEs = async (params) => {
  const {
    env,
    status,
    dbOutput,
    updatedTime,
    esClient,
  } = params;

  await indexer.updateAsyncOperation(
    esClient,
    env.asyncOperationId,
    {
      status,
      output: dbOutput,
      updatedAt: Number(updatedTime),
    },
    process.env.ES_INDEX
  );
};

/**
 * Update an AsyncOperation item in Postgres
 *
 *
 * @param {Object} params
 * @param {string} params.status - the new AsyncOperation status
 * @param {Object} params.output - the new output to store.  Must be parsable JSON
 * @param {Object} params.envOverride - Object to override/extend environment variables
 * @returns {Promise} resolves when the item has been updated
 */
const updateAsyncOperation = async (params) => {
  const {
    status,
    output,
    envOverride = {},
    esClient = await Search.es(),
    asyncOperationPgModel = new AsyncOperationPgModel(),
  } = params;

  const actualOutput = isError(output) ? buildErrorOutput(output) : output;
  const dbOutput = actualOutput ? JSON.stringify(actualOutput) : undefined;
  const updatedTime = envOverride.updateTime || (Number(Date.now())).toString();
  const env = { ...process.env, ...envOverride };

  logger.info(`About to update async operation to ${JSON.stringify(status)} with output: ${dbOutput}`);
  const knex = await getKnexClient({ env });

  return await createRejectableTransaction(knex, async (trx) => {
    const pgRecords = await writeAsyncOperationToPostgres({
      dbOutput,
      env,
      status,
      trx,
      updatedTime,
      asyncOperationPgModel,
    });
    const result = translatePostgresAsyncOperationToApiAsyncOperation(pgRecords[0]);
    await writeAsyncOperationToEs({ env, status, dbOutput, updatedTime, esClient });
    logger.info(`Successfully updated async operation to ${JSON.stringify(status)} with output: ${JSON.stringify(dbOutput)}`);
    return result;
  });
};

/**
 * Download and run a Lambda task locally.  On completion, write the results out
 *   to postgres async_operations table.
 *
 * @returns {Promise<undefined>} resolves when the task has completed
 */
async function runTask() {
  let lambdaInfo;
  let payload;

  logger.debug('Running async operation %s', process.env.asyncOperationId);

  try {
    // Get some information about the lambda function that we'll be calling
    lambdaInfo = await getLambdaInfo(process.env.lambdaName);

    // Download the task (to the /home/task/lambda-function directory)
    await fetchLambdaFunction(lambdaInfo.codeUrl);
  } catch (error) {
    logger.error('Failed to fetch lambda function', error);
    await updateAsyncOperation({
      status: 'RUNNER_FAILED',
      output: error,
    });
    return;
  }

  try {
    // Fetch the event that will be passed to the lambda function from S3
    logger.debug(`Fetching payload from ${process.env.payloadUrl}.`);
    payload = await fetchAndDeletePayload(process.env.payloadUrl);
  } catch (error) {
    logger.error('Failed to fetch payload', error);
    if (error.name === 'JSONParsingError') {
      await updateAsyncOperation({
        status: 'TASK_FAILED',
        output: error,
      });
    } else {
      await updateAsyncOperation({
        status: 'RUNNER_FAILED',
        output: error,
      });
    }
    return;
  }

  let result;
  try {
    logger.debug(`Loading lambda function ${process.env.lambdaName}`);
    // Load the lambda function
    const task = require(`/home/task/lambda-function/${lambdaInfo.moduleFileName}`); //eslint-disable-line global-require, import/no-dynamic-require

    // Run the lambda function
    logger.debug(`Invoking task lambda function: ${process.env.lambdaName}`);
    result = await task[lambdaInfo.moduleFunctionName](payload);
  } catch (error) {
    logger.error('Failed to execute the lambda function:', error);
    await updateAsyncOperation({
      status: 'TASK_FAILED',
      output: error,
    });
    return;
  }

  // Write the result out to databases
  try {
    await updateAsyncOperation({
      status: 'SUCCEEDED',
      output: result,
    });
  } catch (error) {
    logger.error('Failed to update record', error);
    throw error;
  }
  logger.debug('exiting async-operation runTask()');
}

const missingVars = missingEnvironmentVariables();
if (missingVars.length === 0) {
  logger.debug(
    `initiating runTask() with environment: ${requiredEnvironmentalVariables.map((v) => `${v}[${process.env[v]}];`).join(' ')}`
  );
  runTask();
} else {
  logger.error('Missing environment variables:', missingVars.join(', '));
}

module.exports = { updateAsyncOperation };
