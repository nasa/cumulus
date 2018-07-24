'use strict';

const { log } = require('@cumulus/common');

const { AsyncOperation } = require('../models');

const {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  internalServerErrorResponse,
  notFoundResponse
} = require('../lib/response');

async function startBulkDeleteAsyncOperation(params) {
  const {
    asyncOperationsTable,
    asyncOperationTaskDefinition,
    bulkDeleteLambdaName,
    cluster,
    granuleIds,
    stackName,
    systemBucket
  } = params;

  const asyncOperationModel = new AsyncOperation({
    stackName,
    systemBucket,
    tableName: asyncOperationsTable
  });

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

async function handler(event, context, _callback) {
  const getConfigValue = (key) => context[key] || process.env[key];

  // In unit testing, we'll smuggle the table names in using the context.  When
  // this is run in API Gateway, the table names will be set using environment
  // variables
  const asyncOperationsTable = getConfigValue('AsyncOperationsTable');
  const asyncOperationTaskDefinition = getConfigValue('AsyncOperationTaskDefinition');
  const bulkDeleteLambdaName = getConfigValue('BulkDeleteLambda');
  const stackName = getConfigValue('stackName');
  const systemBucket = getConfigValue('systemBucket');
  const usersTable = getConfigValue('UsersTable');
  const cluster = getConfigValue('EcsCluster');

  try {
    // Verify the user's credentials
    const authorizationFailureResponse = await getAuthorizationFailureResponse({
      usersTable,
      request: event
    });
    if (authorizationFailureResponse) return authorizationFailureResponse;

    if (event.httpMethod === 'POST') {
      return await startBulkDeleteAsyncOperation({
        asyncOperationsTable,
        asyncOperationTaskDefinition,
        bulkDeleteLambdaName,
        cluster,
        stackName,
        systemBucket,
        granuleIds: JSON.parse(event.body).granuleIds
      });
    }

    return notFoundResponse;
  }
  catch (err) {
    log.error(err);
    return internalServerErrorResponse;
  }
}
module.exports = handler;
