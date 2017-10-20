'use strict';

const get = require('lodash.get');
const got = require('got');
const forge = require('node-forge');
const { User } = require('../models');
const { resp } = require('../lib/response');
const logger = require('@cumulus/ingest/log');
const log = logger.child({ name: 'cumulus-api-auth' });

function redirectUriParam(uri) {
  const url = uri || process.env.DASHBOARD_ENDPOINT;
  return encodeURIComponent(url);
}

/**
 * AWS API Gateway function that handles callbacks from URS authentication, transforming
 * codes into tokens
 */
function token(event, context, uri) {
  const EARTHDATA_CLIENT_ID = process.env.EARTHDATA_CLIENT_ID;
  const EARTHDATA_CLIENT_PASSWORD = process.env.EARTHDATA_CLIENT_PASSWORD;

  const EARTHDATA_BASE_URL = process.env.EARTHDATA_BASE_URL || 'https://urs.earthdata.nasa.gov';
  const EARTHDATA_CHECK_CODE_URL = `${EARTHDATA_BASE_URL}/oauth/token`;

  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    const params = `?grant_type=authorization_code&code=${code}&redirect_uri=${redirectUriParam(uri)}`;

    console.log(EARTHDATA_CHECK_CODE_URL + params);

    // Verify token
    return got.post(EARTHDATA_CHECK_CODE_URL + params, {
      json: true,
      auth: `${EARTHDATA_CLIENT_ID}:${EARTHDATA_CLIENT_PASSWORD}`
    }).then((r) => {
      const tokenInfo = r.body;
      const access = tokenInfo.access_token;

      // if no access token is given, then the code is wrong
      if (typeof access === 'undefined') {
        return resp(context, new Error('Failed to get Earthdata token'));
      }

      const refresh = tokenInfo.refresh_token;
      const username = tokenInfo.endpoint.split('/').pop();
      const expires = (+new Date()) + (tokenInfo.expires_in * 1000);

      const password = `urs://${access}/${refresh}/${expires}`;

      const md = forge.md.md5.create();
      md.update(password);
      const passwordHash = md.digest().toHex();

      const u = new User();

      return u.get({ userName: username }).then(() =>
        u.update({ userName: username }, { password: passwordHash }).then(() => {
          if (state === 'login') {
            const base64 = new Buffer(`${username}:${password}`).toString('base64');
            resp(context, null, `{ "token": "${base64}" }`, 200);
          }
          else {
            resp(context, null, JSON.stringify({ user: username, password: password }), 200);
          }
        })
      ).catch(e => {
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
function redirect(event, context, cb) {
  const endpoint = process.env.EARTHDATA_BASE_URL;
  const clientId = process.env.EARTHDATA_CLIENT_ID;

  const url = `${endpoint}/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUriParam()}&response_type=code`;
  return cb(null, {
    statusCode: '301',
    body: 'Redirecting to Earthdata Login',
    headers: {
      Location: url
    }
  });
}


/**
 * AWS API Gateway function that redirects to the correct URS endpoint with the correct client
 * ID to be used with the API
 */
function login(event, context, cb) {
  const endpoint = process.env.EARTHDATA_BASE_URL;
  const clientId = process.env.EARTHDATA_CLIENT_ID;
  const redirectUri = process.env.API_ENDPOINT;

  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  if (code && state === 'login') {
    return token(event, context, redirectUri);
  }

  const url = `${endpoint}/oauth/authorize?` +
              `client_id=${clientId}&` +
              `redirect_uri=${redirectUriParam(redirectUri)}&state=login&response_type=code`;
  return cb(null, {
    statusCode: '301',
    body: 'Redirecting to Earthdata Login',
    headers: {
      Location: url
    }
  });
}

function handler(event, context, cb) {
  if (event.httpMethod === 'GET' && event.resource === '/auth/token') {
    return token(event, context);
  }
  else if (event.httpMethod === 'GET' && event.resource === '/auth/redirect') {
    return redirect(event, context, cb);
  }
  else if (event.httpMethod === 'GET' && event.resource === '/auth/login') {
    return login(event, context, cb);
  }
  return resp(context, new Error('Not found'), 404);
}

module.exports = handler;
