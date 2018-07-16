'use strict';

const get = require('lodash.get');
const { log } = require('@cumulus/common');

const { AsyncOperation: AsyncOperationModel } = require('../models');
const {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  internalServerErrorResponse,
  notFoundResponse
} = require('../lib/response');

async function getAsyncOperation(asyncOperationsTable, id) {
  const asyncOperationModel = new AsyncOperationModel({ tableName: asyncOperationsTable });

  let asyncOperation;
  try {
    asyncOperation = await asyncOperationModel.get({ id });
  }
  catch (err) {
    if (err.message.startsWith('No record found')) return notFoundResponse;
    throw err;
  }

  return buildLambdaProxyResponse({
    json: true,
    body: {
      id: asyncOperation.id,
      status: asyncOperation.status,
      results: asyncOperation.results
    }
  });
}

async function handler(event, context, _callback) {
  // In testing, we'll smuggle the table names in using the context.  When
  // this is run in API Gateway, the table names will be set using environment
  // variables
  const usersTable = context.UsersTable || process.env.UsersTable;
  const asyncOperationsTable = context.AsyncOperationsTable || process.env.AsyncOperationsTable;

  try {
    // Verify the user's credentials
    const authorizationFailureResponse = await getAuthorizationFailureResponse({
      usersTable,
      request: event
    });
    if (authorizationFailureResponse) return authorizationFailureResponse;

    if (event.httpMethod === 'GET' && get(event, 'pathParameters.id')) {
      return getAsyncOperation(asyncOperationsTable, event.pathParameters.id);
    }

    return notFoundResponse;
  }
  catch (err) {
    log.error(err);
    return internalServerErrorResponse;
  }
}
module.exports = handler;
