'use strict';

const get = require('lodash.get');
const { google } = require('googleapis');
const plus = google.plus('v1');
const { User } = require('../models');
const { resp } = require('../lib/response');
const log = require('@cumulus/common/log');

const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.EARTHDATA_CLIENT_ID,
  process.env.EARTHDATA_CLIENT_PASSWORD,
  process.env.API_ENDPOINT
);

/**
 * AWS API Gateway function that handles callbacks from authentication, transforming
 * codes into tokens
 *
 * @param  {Object} event   - Lambda event object
 * @param  {Object} context - Lambda context object
 * @returns {Object}         Response object including status, headers and body key / values.
 */
function token(event, context) {
  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    return oauth2Client.getToken(code, (error, tokens) => {
      if (error) {
        return resp(context, new Error(error));
      }
      const accessToken = tokens.access_token;
      const tokenExpires = tokens.expiry_date;
      const expires = (+new Date()) + (tokenExpires * 1000);

      // Now tokens contains an access_token and an optional refresh_token. Save them.
      if (!error) {
        oauth2Client.setCredentials(tokens);
      }

      return plus.people.get({
        userId: 'me',
        auth: oauth2Client
      }, (err, response) => {
        if (err) log.error(err);
        const userData = response.data;
        // not sure if it's possible to have multiple emails but they are
        // returned as a list. If users have multiple emails we will have to
        // scan the users table to see if any match.
        const userEmail = userData.emails[0].value;

        const u = new User();
        return u.get({ userName: userEmail })
          .then(() => {
            u.update({ userName: userEmail }, { password: accessToken, expires });
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
      });
    });
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
  // generate a url that asks permissions for Google+ and Google Calendar scopes
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  if (code) {
    return this.token(event, context);
  }

  const url = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: 'offline',

    // If you only need one scope you can pass it as a string
    scope: scopes,
    state: state
  });

  return cb(null, {
    statusCode: '301',
    body: 'Redirecting to Google Login',
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
