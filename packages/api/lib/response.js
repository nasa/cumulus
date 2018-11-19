/**
 * This module helps with returning approporiate
 * response via API Gateway Lambda Proxies
 *
 * With the lambda proxy integration, the succeed method of
 * the context object should always be called. It accepts
 * an object that expects a statusCode, headers and body
 */

'use strict';

const isFunction = require('lodash.isfunction');
const isString = require('lodash.isstring');
const log = require('@cumulus/common/log');
const { deprecate } = require('@cumulus/common/util');
const {
  decode: jwtDecode,
  JsonWebTokenError,
  TokenExpiredError
} = require('jsonwebtoken');

const { User } = require('../models');
const { verifyJwtToken } = require('./token');
const { errorify, findCaseInsensitiveKey } = require('./utils');
const {
  AuthorizationFailureResponse,
  InternalServerError,
  LambdaProxyResponse,
  InvalidTokenResponse,
  TokenExpiredResponse
} = require('./responses');

function resp(context, err, bodyArg, statusArg = null, headers = {}) {
  deprecate(
    '@cumulus/api/response.resp()',
    '1.10.3',
    '@cumulus/api/responses'
  );

  if (!isFunction(context.succeed)) {
    throw new TypeError('context as object with succeed method not provided');
  }

  let body = bodyArg;
  let statusCode = statusArg;

  if (err) {
    log.error(err);
    statusCode = statusCode || 400;
    body = {
      message: err.message || errorify(err),
      detail: err.detail
    };
  }

  return context.succeed(new LambdaProxyResponse({
    json: !isString(body),
    body,
    statusCode,
    headers
  }));
}

function buildLambdaProxyResponse(params = {}) {
  deprecate(
    '@cumulus/api/response.buildLambdaProxyResponse()',
    '1.10.3',
    '@cumulus/api/responses'
  );
  return new LambdaProxyResponse(params);
}

function buildAuthorizationFailureResponse(params) {
  deprecate(
    '@cumulus/api/response.buildAuthorizationFailureResponse()',
    '1.10.3',
    '@cumulus/api/responses'
  );
  return new AuthorizationFailureResponse(params);
}

/**
 * Check an API request and, if there is an authorization failure, return a
 * Lambda Proxy response object appropriate for that failure.  If there is no
 * error, return null.
 *
 * @param {Object} params - params
 * @param {Object} params.request - An API Gateway request.  This will be the
 *   event argument in the Lambda handler.
 * @param {string} params.usersTable - The name of the DynamoDB Users table
 * @returns {Object|null} - A Lambda Proxy response object if there was an
 *   authorization failure, or null if the authorization is.
 */
async function getAuthorizationFailureResponse(params) {
  const {
    request,
    usersTable
  } = params;

  // Verify that the Authorization header was set in the request
  const authorizationKey = findCaseInsensitiveKey(request.headers, 'Authorization');
  if (!authorizationKey) {
    return new AuthorizationFailureResponse({
      message: 'Authorization header missing'
    });
  }

  // Parse the Authorization header
  const [scheme, jwtToken] = request.headers[authorizationKey].trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    return new AuthorizationFailureResponse({
      error: 'invalid_request',
      message: 'Authorization scheme must be Bearer'
    });
  }

  // Verify that a token was set in the Authorization header
  if (!jwtToken) {
    return new AuthorizationFailureResponse({
      error: 'invalid_request',
      message: 'Missing token'
    });
  }

  try {
    verifyJwtToken(jwtToken);
  }
  catch (error) {
    log.error('Error caught when checking JWT token', error);
    if (error instanceof TokenExpiredError) {
      return new TokenExpiredResponse();
    }
    if (error instanceof JsonWebTokenError) {
      return new InvalidTokenResponse();
    }
  }

  const { username } = jwtDecode(jwtToken);

  const userModel = new User({ tableName: usersTable });
  try {
    await userModel.get({ userName: username });
  }
  catch (err) {
    if (err.name === 'RecordDoesNotExist') {
      return new AuthorizationFailureResponse({
        message: 'User not authorized',
        statusCode: 403
      });
    }
  }

  return null;
}

function handle(event, context, authCheck, func) {
  if (!isFunction(context.succeed)) {
    throw new TypeError('context object with succeed method not provided');
  }

  const cb = resp.bind(null, context);

  if (authCheck) {
    return getAuthorizationFailureResponse({
      request: event,
      usersTable: process.env.UsersTable
    })
      .then((failureReponse) => {
        if (failureReponse) {
          return context.succeed(failureReponse);
        }
        return func(cb);
      })
      .catch((err) => {
        log.error(err);
        return context.succeed(new InternalServerError());
      });
  }

  return func(cb);
}

const notFoundResponse = buildLambdaProxyResponse({
  json: true,
  statusCode: 404,
  body: { message: 'Not found' }
});

const internalServerErrorResponse = buildLambdaProxyResponse({
  json: true,
  statusCode: 500,
  body: { message: 'Internal Server Error' }
});

module.exports = {
  buildAuthorizationFailureResponse,
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  handle,
  internalServerErrorResponse,
  notFoundResponse,
  resp
};
