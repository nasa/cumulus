'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');

const { User } = require('../models');
const {
  buildAuthorizationFailureResponse,
  buildLambdaProxyResponse
} = require('../lib/response');

async function token(event, oAuth2Provider) {
  const code = get(event, 'queryStringParameters.code');
  const state = get(event, 'queryStringParameters.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    try {
      const {
        accessToken,
        refreshToken: refresh,
        username: userName,
        expirationTime: expires
      } = await oAuth2Provider.getAccessToken(code);

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
      if (e.statusCode === 400) {
        return buildAuthorizationFailureResponse({
          error: 'authorization_failure',
          message: 'Failed to get authorization token'
        });
      }

      log.error('Error caught when checking code:', e);
      return buildAuthorizationFailureResponse({ error: e, message: e.message });
    }
  }

  const errorMessage = 'Request requires a code';
  const error = new Error(errorMessage);
  return buildAuthorizationFailureResponse({ error: error, message: error.message });
}

async function login(request, oAuth2Provider) {
  const code = get(request, 'queryStringParameters.code');
  const state = get(request, 'queryStringParameters.state');

  if (code) {
    return token(request, oAuth2Provider);
  }

  const authorizationUrl = oAuth2Provider.getAuthorizationUrl(state);

  return buildLambdaProxyResponse({
    json: false,
    statusCode: 301,
    body: 'Redirecting to login',
    headers: {
      Location: authorizationUrl
    }
  });
}

async function handleRequest(request, oAuth2Provider) {
  if (request.httpMethod === 'GET' && request.resource.endsWith('/token')) {
    return login(request, oAuth2Provider);
  }

  return buildLambdaProxyResponse({
    json: false,
    statusCode: 404,
    body: 'Not found'
  });
}

module.exports = {
  handleRequest,
  login,
  token
};
