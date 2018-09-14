'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');

const authHelpers = require('../lib/authHelpers');
const { User } = require('../models');
const {
  buildAuthorizationFailureResponse,
  buildLambdaProxyResponse
} = require('../lib/response');

/**
 * AWS API Gateway function that handles callbacks from authentication, transforming
 * codes into tokens
 *
 * @param  {Object} event   - Lambda event object
 * @returns {Object}        - a Lambda Proxy response object
 */
async function token(event) {
  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    try {
      const responseObject = await authHelpers.getToken(code);
      const {
        userName, accessToken, refresh, expires
      } = responseObject;
      const u = new User();

      return u.get({ userName })
        .then(() => u.update({ userName }, { password: accessToken, refresh, expires }))
        .then(() => {
          if (state) {
            log.info(`Log info: Redirecting to state: ${state} with token ${accessToken}`);
            return buildLambdaProxyResponse({
              json: false,
              statusCode: 301,
              body: 'Redirecting to the specified state',
              headers: {
                'Content-Type': 'text/plain',
                Location: `${decodeURIComponent(state)}?token=${accessToken}`
              }
            });
          }
          log.info('Log info: No state specified, responding 200');
          return buildLambdaProxyResponse({
            json: true,
            statusCode: 200,
            body: { message: { token: accessToken } }
          });
        })
        .catch((e) => {
          if (e.message.includes('No record found for')) {
            const errorMessage = 'User is not authorized to access this site';
            return buildAuthorizationFailureResponse({
              error: new Error(errorMessage),
              message: errorMessage
            });
          }
          return buildAuthorizationFailureResponse({ error: e, message: e.message });
        });
    }
    catch (e) {
      log.error('Error caught when checking code:', e);
      return buildAuthorizationFailureResponse({ error: e, message: e.message });
    }
  }

  const errorMessage = 'Request requires a code';
  const error = new Error(errorMessage);
  return buildAuthorizationFailureResponse({ error: error, message: error.message });
}

/**
 * `login` is an AWS API Gateway function that redirects to the correct
 * authentication endpoint with the correct client ID to be used with the API
 *
 * @param  {Object} event   - Lambda event object
 * @returns {Object} - a Lambda Proxy response object
 */
async function login(event) {
  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  if (code) {
    return token(event);
  }

  const url = authHelpers.generateLoginUrl(state);

  return buildLambdaProxyResponse({
    json: false,
    statusCode: 301,
    body: 'Redirecting to login',
    headers: {
      Location: url
    }
  });
}

/**
 * Main handler for the token endpoint.
 *
 * @function handler
 * @param  {Object}   event   - Lambda event payload
 * @returns {Object} - a Lambda Proxy response object
 */
async function handler(event) {
  if (event.httpMethod === 'GET' && event.resource.endsWith('/token')) {
    return login(event);
  }

  return buildLambdaProxyResponse({
    json: false,
    statusCode: 404,
    body: 'Not found'
  });
}

module.exports = {
  handler,
  login,
  token
};
