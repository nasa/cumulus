'use strict';

const get = require('lodash.get');
const got = require('got');
const { User } = require('../models');
const { resp } = require('../lib/response');
const logger = require('@cumulus/ingest/log');
const log = logger.child({ name: 'cumulus-api-auth' });

function redirectUriParam() {
  const url = process.env.API_ENDPOINT;
  return encodeURIComponent(url);
}

/**
 * AWS API Gateway function that handles callbacks from URS authentication, transforming
 * codes into tokens
 */
function token(event, context) {
  const EARTHDATA_CLIENT_ID = process.env.EARTHDATA_CLIENT_ID;
  const EARTHDATA_CLIENT_PASSWORD = process.env.EARTHDATA_CLIENT_PASSWORD;

  const EARTHDATA_BASE_URL = process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov';
  const EARTHDATA_CHECK_CODE_URL = `${EARTHDATA_BASE_URL}/oauth/token`;

  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    const params = `?grant_type=authorization_code&code=${code}&redirect_uri=${redirectUriParam()}`;

    // Verify token
    return got.post(EARTHDATA_CHECK_CODE_URL + params, {
      json: true,
      auth: `${EARTHDATA_CLIENT_ID}:${EARTHDATA_CLIENT_PASSWORD}`
    }).then((r) => {
      const tokenInfo = r.body;
      const accessToken = tokenInfo.access_token;

      // if no access token is given, then the code is wrong
      if (typeof accessToken === 'undefined') {
        return resp(context, new Error('Failed to get Earthdata token'));
      }

      const refresh = tokenInfo.refresh_token;
      const userName = tokenInfo.endpoint.split('/').pop();
      const expires = (+new Date()) + (tokenInfo.expires_in * 1000);

      const u = new User();

      return u.create({ userName, password: accessToken, refresh, expires }).then(() => {
        if (state) {
          return resp(context, null, 'Redirecting to the specified state', 301, {
            Location: `${decodeURIComponent(state)}?token=${accessToken}`
          });
        }
        return resp(context, null, JSON.stringify({ token: accessToken }), 200);
      }).catch(e => {
        log.error('User is not authorized', e);
        resp(context, e);
      });
    }).catch(e => {
      log.error('Error caught when checking code:', e);
      resp(context, e);
    });
  }
  return resp(context, new Error('Request requires a code'));
}

/**
 * AWS API Gateway function that redirects to the correct URS endpoint with the correct client
 * ID to be used with the API
 */
function login(event, context, cb) {
  const endpoint = process.env.EARTHDATA_BASE_URL;
  const clientId = process.env.EARTHDATA_CLIENT_ID;

  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  if (code) {
    return token(event, context);
  }

  let url = `${endpoint}/oauth/authorize?` +
              `client_id=${clientId}&` +
              `redirect_uri=${redirectUriParam()}&response_type=code`;
  if (state) {
    url = `${url}&state=${encodeURIComponent(state)}`;
  }
  return cb(null, {
    statusCode: '301',
    body: 'Redirecting to Earthdata Login',
    headers: {
      Location: url
    }
  });
}

function handler(event, context, cb) {
  if (event.httpMethod === 'GET' && event.resource === '/token') {
    return login(event, context, cb);
  }
  return resp(context, new Error('Not found'), 404);
}

module.exports = handler;
