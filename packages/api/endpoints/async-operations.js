'use strict';

const get = require('lodash.get');
const { log } = require('@cumulus/common');
const pick = require('lodash.pick');

const { AsyncOperation: AsyncOperationModel } = require('../models');
const {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  internalServerErrorResponse,
  notFoundResponse
} = require('../lib/response');

async function getAsyncOperation(asyncOperationModel, id) {
  let asyncOperation;
  try {
    asyncOperation = await asyncOperationModel.get(id);
  }
  catch (err) {
    if (err.message.startsWith('No record found')) return notFoundResponse;
    throw err;
  }

  return buildLambdaProxyResponse({
    json: true,
    body: pick(asyncOperation, ['id', 'status', 'taskArn', 'result', 'error'])
  });
}

async function handler(event, context, _callback) {
  try {
    // In testing, we'll smuggle the table names in using the context.  When
    // this is run in API Gateway, the table names will be set using environment
    // variables
    const usersTable = context.UsersTable || process.env.UsersTable;
    const asyncOperationsTable = context.AsyncOperationsTable || process.env.AsyncOperationsTable;
    const stackName = context.stackName || process.env.stackName;
    const systemBucket = context.systemBucket || process.env.systemBucket;

    const asyncOperationModel = new AsyncOperationModel({
      stackName,
      systemBucket,
      tableName: asyncOperationsTable
    });

    // Verify the user's credentials
    const authorizationFailureResponse = await getAuthorizationFailureResponse({
      usersTable,
      request: event
    });
    if (authorizationFailureResponse) return authorizationFailureResponse;

    if (event.httpMethod === 'GET' && get(event, 'pathParameters.id')) {
      return getAsyncOperation(asyncOperationModel, event.pathParameters.id);
    }

    return notFoundResponse;
  }
  catch (err) {
    log.error(err);
    return internalServerErrorResponse;
  }
}
module.exports = handler;
