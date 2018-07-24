'use strict';

const { log } = require('@cumulus/common');
const { AsyncOperation } = require('../models');
const {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  internalServerErrorResponse,
  notFoundResponse
} = require('../lib/response');

/**
 * Start an AsyncOperation that will perform a bulk delete
 *
 * @param {Object} params - params
 * @param {Object} params.asyncOperationModel - an instance of an AsyncOperation
 *   model
 * @param {string} params.asyncOperationTaskDefinition - the name or ARN of the
 *   async-operation ECS task definition
 * @param {string} params.bulkDeleteLambdaName - the name of the Lambda function
 *   to be run as an AsyncOperation
 * @param {string} params.cluster - the name of the ECS cluster
 * @param {string} params.granuleIds - the granuleIds to be deleted
 * @returns {Promise<Object>} - a Lambda proxy response
 */
async function startBulkDeleteAsyncOperation(params) {
  const {
    asyncOperationModel,
    asyncOperationTaskDefinition,
    bulkDeleteLambdaName,
    cluster,
    granuleIds
  } = params;

  const asyncOperation = await asyncOperationModel.start({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName: bulkDeleteLambdaName,
    payload: { granuleIds }
  });

  return buildLambdaProxyResponse({
    json: true,
    statusCode: 202,
    body: { asyncOperationId: asyncOperation.id }
  });
}

/**
 * Handle an API Gateway Lambda Proxy request related to Bulk Deletes
 *
 * @param {Object} event - a Lambda Proxy request
 * @param {Object} context - the Lambda context
 * @returns {Promise<Object>} - returns a Lambda Proxy response
 */
async function handler(event, context) {
  // In testing, we'll smuggle the table names in using the context.  When
  // this is run in API Gateway, the table names will be set using environment
  // variables
  const getConfigValue = (key) => {
    const value = context[key] || process.env[key];
    if (!value) throw new Error(`${key} must be set.`);
    return value;
  };

  try {
    // If any of these are missing, an exception will be thrown and a 500
    // response will be returned to the caller.
    const asyncOperationsTable = getConfigValue('AsyncOperationsTable');
    const asyncOperationTaskDefinition = getConfigValue('AsyncOperationTaskDefinition');
    const bulkDeleteLambdaName = getConfigValue('BulkDeleteLambda');
    const stackName = getConfigValue('stackName');
    const systemBucket = getConfigValue('systemBucket');
    const usersTable = getConfigValue('UsersTable');
    const cluster = getConfigValue('EcsCluster');

    // Verify the user's credentials
    const authorizationFailureResponse = await getAuthorizationFailureResponse({
      usersTable,
      request: event
    });
    if (authorizationFailureResponse) return authorizationFailureResponse;

    // Figure out where to route the request
    if (event.httpMethod === 'POST') {
      const asyncOperationModel = new AsyncOperation({
        stackName,
        systemBucket,
        tableName: asyncOperationsTable
      });

      return await startBulkDeleteAsyncOperation({
        asyncOperationModel,
        asyncOperationTaskDefinition,
        bulkDeleteLambdaName,
        cluster,
        granuleIds: JSON.parse(event.body).granuleIds
      });
    }

    // If nothing matched, return a 404 response
    return notFoundResponse;
  }
  catch (err) {
    // If an exception was thrown, log it and return an Internal Server Error
    log.error(err);
    return internalServerErrorResponse;
  }
}
module.exports = handler;
