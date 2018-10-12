/**
 * This module helps with returning approporiate
 * response via API Gateway Lambda Proxies
 *
 * With the lambda proxy integration, the succeed method of
 * the context object should always be called. It accepts
 * an object that expects a statusCode, headers and body
 */

'use strict';

const isString = require('lodash.isstring');
const deprecate = require('depd')('@cumulus/api/lib/response');
const log = require('@cumulus/common/log');
const { User } = require('../models');
const { errorify } = require('./utils');
const {
  AuthorizationFailureResponse,
  InternalServerError,
  LambdaProxyResponse
} = require('./responses');

/**
 * Find a property name in an object in a case-insensitive manner
 *
 * @param {Object} obj - the object to be searched
 * @param {string} keyArg - the name of the key to find
 * @returns {string|undefined} - the name of the matching key, or undefined if
 *   none was found
 */
function findCaseInsensitiveKey(obj, keyArg) {
  const keys = Object.keys(obj);
  return keys.find((key) => key.toLowerCase() === keyArg.toLowerCase());
}

function resp(context, err, bodyArg, statusArg = null, headers = {}) {
  deprecate('resp(), use getAuthorizationFailureResponse() and buildLambdaProxyResponse() instead,'); // eslint-disable-line max-len

  if (typeof context.succeed !== 'function') {
    throw new TypeError('context as object with succeed method not provided');
  }

  let body = bodyArg;
  let status = statusArg;

  if (err) {
    log.error(err);
    status = status || 400;
    body = {
      message: err.message || errorify(err),
      detail: err.detail
    };
  }

  return context.succeed(new LambdaProxyResponse({
    json: !isString(body),
    body,
    statusCode: status,
    headers
  }));
}

function buildLambdaProxyResponse(params = {}) {
  deprecate('buildLambdaProxyResponse(), use `new LambdaProxyResponse()` instead,');
  return new LambdaProxyResponse(params);
}

function buildAuthorizationFailureResponse(params) {
  deprecate('buildAuthorizationFailureResponse(), use `new AuthorizationFailureResponse()` instead,'); // eslint-disable-line max-len
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
  const [scheme, token] = request.headers[authorizationKey].trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    return new AuthorizationFailureResponse({
      error: 'invalid_request',
      message: 'Authorization scheme must be Bearer'
    });
  }

  // Verify that a token was set in the Authorization header
  if (!token) {
    return new AuthorizationFailureResponse({
      error: 'invalid_request',
      message: 'Missing token'
    });
  }

  const userModelClient = new User(usersTable);
  const findUserResult = await userModelClient.scan({
    filter: 'password = :token',
    values: { ':token': token }
  });

  // Verify that the token exists in the DynamoDB Users table
  if (findUserResult.Count !== 1) {
    return new AuthorizationFailureResponse({
      message: 'User not authorized',
      statusCode: 403
    });
  }

  // Not sure how this could ever happen
  if (findUserResult.Items[0].expires === undefined) {
    log.error('Token does not have an expires field:', token);
    return new InternalServerError();
  }

  // Verify that the token has not expired
  if (findUserResult.Items[0].expires < Date.now()) {
    return new AuthorizationFailureResponse({
      message: 'Access token has expired',
      statusCode: 403
    });
  }

  return null;
}

function handle(event, context, authCheck, func) {
  if (typeof context.succeed !== 'function') {
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

module.exports = {
  buildAuthorizationFailureResponse,
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  handle,
  resp
};
