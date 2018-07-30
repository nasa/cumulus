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

/**
 * Returns a Lambda Proxy response containing the requested AsyncOperation,
 *   or a 404 response if it was not found.
 *
 * @param {Object} asyncOperationModel - an instance of an AsyncOperation model
 * @param {string} id - an AsyncOperation id
 * @returns {Promise<Object>} - an API Gateway Lambda Proxy response
 */
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
    body: pick(asyncOperation, ['id', 'status', 'taskArn', 'output'])
  });
}

/**
 * Fetch the required config values
 *
 * In testing, we'll smuggle the table names in using the context.  When this is
 * run in API Gateway, the table names will be set using environment variables
 *
 * @param {Object} context - a Lambda context
 * @returns {Object} the config for the Lambda function
 */
function getConfig(context) {
  const getConfigValue = (key) => {
    const value = context[key] || process.env[key];
    if (!value) throw new Error(`${key} must be set.`);
    return value;
  };

  return {
    asyncOperationsTable: getConfigValue('AsyncOperationsTable'),
    stackName: getConfigValue('stackName'),
    systemBucket: getConfigValue('systemBucket'),
    usersTable: getConfigValue('UsersTable')
  };
}

/**
 * Handle an API Gateway Lambda Proxy request related to AsyncOperations
 *
 * @param {Object} event - a Lambda Proxy request
 * @param {Object} context - the Lambda context
 * @returns {Promise<Object>} - returns a Lambda Proxy response
 */
async function handler(event, context = {}) {
  try {
    const {
      asyncOperationsTable,
      stackName,
      systemBucket,
      usersTable
    } = getConfig(context);

    // Verify the user's credentials
    const authorizationFailureResponse = await getAuthorizationFailureResponse({
      usersTable,
      request: event
    });
    if (authorizationFailureResponse) return authorizationFailureResponse;

    const asyncOperationModel = new AsyncOperationModel({
      stackName,
      systemBucket,
      tableName: asyncOperationsTable
    });

    // Figure out where to route the request
    if (event.httpMethod === 'GET' && get(event, 'pathParameters.id')) {
      return getAsyncOperation(asyncOperationModel, event.pathParameters.id);
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
