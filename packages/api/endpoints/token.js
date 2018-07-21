'use strict';

const get = require('lodash.get');
const authHelpers = require('../lib/authHelpers');
const { User } = require('../models');
const { resp } = require('../lib/response');
const log = require('@cumulus/common/log');

/**
 * AWS API Gateway function that handles callbacks from authentication, transforming
 * codes into tokens
 *
 * @param  {Object} event   - Lambda event object
 * @param  {Object} context - Lambda context object
 * @returns {Object}         Response object including status, headers and body key / values.
 */
async function token(event, context) {
  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    try {
      const {
        userName, accessToken, refresh, expires
      } = await authHelpers.getToken(code);
      const u = new User();

      return u.get({ userName })
        .then(() => {
          u.update({ userName }, { password: accessToken, refresh, expires });
        })
        .then(() => {
          if (state) {
            log.info(`Log info: Redirecting to state: ${state} with token ${accessToken}`);
            return resp(context, null, 'Redirecting to the specified state', 301, {
              Location: `${decodeURIComponent(state)}?token=${accessToken}`
            });
          }
          log.info('Log info: No state specified, responding 200');
          return resp(context, null, JSON.stringify({ token: accessToken }), 200);
        })
        .catch((e) => {
          if (e.message.includes('No record found for')) {
            return resp(context, new Error('User is not authorized to access this site'));
          }
          return resp(context, e);
        });
    }
    catch (e) {
      log.error('Error caught when checking code:', e);
      return resp(context, e);
    }
  }
  return resp(context, new Error('Request requires a code'));
}

/**
 * `login` is an AWS API Gateway function that redirects to the correct
 * authentication endpoint with the correct client ID to be used with the API
 *
 * @param  {Object} event   - Lambda event object
 * @param  {Object} context - Lambda context object
 * @param  {Function} cb    - Lambda callback function
 * @returns {Function}       Lambda callback function
 */
function login(event, context, cb) {
  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  if (code) {
    return this.token(event, context);
  }

  const url = authHelpers.generateLoginUrl(state);

  return cb(null, {
    statusCode: '301',
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
 * @param  {Object}   context - Lambda context - provided by AWS
 * @param  {Function} cb      - Lambda callback function
 * @returns {Function}         Calls the `login` or `resp` function.
 */
function handler(event, context, cb) {
  if (event.httpMethod === 'GET' && event.resource.endsWith('/token')) {
    return login(event, context, cb);
  }
  return resp(context, new Error('Not found'), 404);
}

module.exports = {
  handler,
  login,
  token
};
