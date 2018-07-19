/**
 * This module helps with returning approporiate
 * response via API Gateway Lambda Proxies
 *
 * With the lambda proxy integration, the succeed method of
 * the context object should always be called. It accepts
 * an object that expects a statusCode, headers and body
 */

'use strict';

const deprecate = require('depd')('@cumulus/api/lib/response');
const log = require('@cumulus/common/log');
const proxy = require('lambda-proxy-utils');
const { User } = require('../models');
const { errorify } = require('./utils');

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

const BEARER_REGEX = /^ *(?:[Bb][Ee][Aa][Rr][Ee][Rr]) +([A-Za-z0-9._~+/-]+=*) *$/;

function getToken(req) {
  if (!req.headers || typeof req.headers !== 'object') {
    throw new TypeError('argument req is required to have headers property');
  }

  const authorization = req.headers.authorization;

  const match = BEARER_REGEX.exec(authorization);

  if (!match) {
    return undefined;
  }

  return match[1];
}

function resp(context, err, bodyArg, statusArg = null, headers = {}) { // eslint-disable-line prefer-arrow-callback, max-len
  deprecate('resp(), use getAuthorizationFailureResponse() and buildLambdaProxyResponse() instead,'); // eslint-disable-line max-len

  if (typeof context.succeed !== 'function') {
    throw new Error('context as object with succeed method not provided');
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

  const res = new proxy.Response({ cors: true, statusCode: status });

  Object.keys(headers).forEach((h) => res.set(h, headers[h]));
  res.set('Strict-Transport-Security', 'max-age=31536000');

  return context.succeed(res.send(body));
}

/**
 * Build a valid API Gateway response for an endpoint using Lambda Proxy
 * integration.
 *
 * See: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-output-format
 *
 * @param {Object} params - params
 * @param {boolean} params.json - If true, will set the Content-Type header to
 *   'application/json' and will convert the body argument to a JSON string.
 *   If the json argument is set to true and the caller specifies a Content-Type
 *   in the headers argument, that specified headers argument will not be
 *   overwritten.  If the json argument is set to true, the body argument must
 *   be a plain Javascript Object or an Array.  Anything else will result in
 *   a TypeError being thrown.  Defaults to false.
 * @param {string} params.body - The body of the response.  If json is set to
 *   true, must be a plain Javascript Object or an Array.  If json is set to
 *   false, must be a string.
 * @param {Object} params.headers - Headers to set on the response.  In addition
 *   to the specified headers, the 'Access-Control-Allow-Origin' header will
 *   always be set to '*' and the 'Strict-Transport-Security' header will
 *   always be set to 'max-age=31536000'.
 * @param {integer} params.statusCode - The status code of the response.
 *   Defaults to 200.
 * @returns {Object} - a Lambda Proxy response object
 */
function buildLambdaProxyResponse(params = {}) {
  // Parse params.  If this syntax looks unfamiliar, see:
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment
  const {
    body: bodyArg,
    headers: headersArg = {},
    json = false,
    statusCode = 200
  } = params;

  // By default, the body is whatever was passed in.  If json=true then the body
  // will be replaced.
  let body = bodyArg;

  // Set required response headers
  const requiredHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Strict-Transport-Security': 'max-age=31536000'
  };
  const headers = Object.assign({}, headersArg, requiredHeaders);

  if (json) {
    // Make sure that the body argument is an array or an object
    if (!bodyArg || typeof bodyArg === 'string' || bodyArg instanceof String) {
      throw new TypeError('body must be an object or array when json is true');
    }

    body = JSON.stringify(bodyArg);

    // If a Content-Type header was not specified by the user, specify one.
    // Note: header names are not case-sensitive, so we need to check for a
    //       specified Content-Type header in any case.
    const contentTypeKey = findCaseInsensitiveKey(headers, 'Content-Type');
    if (!contentTypeKey) headers['Content-Type'] = 'application/json';
  }

  return {
    statusCode,
    headers,
    body
  };
}

/**
 * Create a response for an API Gateway Lambda Proxy for failed authorization
 *
 * See https://tools.ietf.org/html/rfc6750#section-3 for more information about
 * these response values.
 *
 * @param {Object} params - params
 * @param {string} params.error - an optional OAuth 2.0 error code
 * @param {string} params.message - an optional error message
 * @returns {Object} - a Lambda Proxy response object
 * @private
 */
function buildAuthorizationFailureResponse(params) {
  const {
    error,
    message
  } = params;

  let wwwAuthenticateValue = 'Bearer';
  if (error) {
    wwwAuthenticateValue = `Bearer error="${error}", error_description="${message}"`;
  }

  return buildLambdaProxyResponse({
    json: true,
    statusCode: 401,
    headers: { 'WWW-Authenticate': wwwAuthenticateValue },
    body: { message }
  });
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
    return buildAuthorizationFailureResponse({
      message: 'Authorization header missing'
    });
  }

  // Parse the Authorization header
  const [scheme, token] = request.headers[authorizationKey].trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    return buildAuthorizationFailureResponse({
      error: 'invalid_request',
      message: 'Authorization scheme must be Bearer'
    });
  }

  // Verify that a token was set in the Authorization header
  if (!token) {
    return buildAuthorizationFailureResponse({
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
    return buildAuthorizationFailureResponse({
      error: 'invalid_token',
      message: 'Invalid Authorization token'
    });
  }

  // Verify that the token has not expired
  if (findUserResult.Items[0].expires < Date.now()) {
    return buildAuthorizationFailureResponse({
      error: 'invalid_token',
      message: 'The access token expired'
    });
  }

  return null;
}

function handle(event, context, authCheck, func) {
  if (typeof context.succeed !== 'function') {
    throw new Error('context object with succeed method not provided');
  }

  const cb = resp.bind(null, context);
  if (authCheck) {
    const req = new proxy.Request(event);

    const token = getToken(req);

    if (!token) return cb('Invalid Authorization token');

    // get the user
    const u = new User();
    return u.scan({
      filter: 'password = :token',
      values: { ':token': token }
    }).then((results) => {
      if (results.Count < 1 || results.Count > 1) {
        return cb('Invalid Authorization token');
      }
      const obj = results.Items[0];

      if (!obj.expires) return cb('Invalid Authorization token');
      else if (obj.expires < Date.now()) return cb('Session expired');
      return func(cb);
    }).catch((e) => cb('Invalid Authorization token', e));
  }
  return func(cb);
}

module.exports = {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse,
  handle,
  resp
};
