'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');

const { google } = require('googleapis');

const EarthdataLogin = require('../lib/EarthdataLogin');
const GoogleOAuth2 = require('../lib/GoogleOAuth2');

const { User } = require('../models');
const {
  buildAuthorizationFailureResponse,
  buildLambdaProxyResponse
} = require('../lib/response');

const buildPermanentRedirectResponse = (location) =>
  buildLambdaProxyResponse({
    json: false,
    statusCode: 301,
    body: 'Redirecting',
    headers: {
      Location: location
    }
  });

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
            return buildPermanentRedirectResponse(
              `${decodeURIComponent(state)}?token=${accessToken}`
            );
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
            return buildAuthorizationFailureResponse({
              message: 'User not authorized',
              statusCode: 403
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

/**
 * Handle client authorization
 *
 * @param {Object} request - an API Gateway request
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @returns {Object} an API Gateway response
 */
async function login(request, oAuth2Provider) {
  const code = get(request, 'queryStringParameters.code');
  const state = get(request, 'queryStringParameters.state');

  if (code) {
    return token(request, oAuth2Provider);
  }

  const authorizationUrl = oAuth2Provider.getAuthorizationUrl(state);

  return buildPermanentRedirectResponse(authorizationUrl);
}

const isGetTokenRequest = (request) =>
  request.httpMethod === 'GET'
  && request.resource.endsWith('/token');

const notFoundResponse = buildLambdaProxyResponse({
  json: false,
  statusCode: 404,
  body: 'Not found'
});

async function handleRequest(request, oAuth2Provider) {
  if (isGetTokenRequest(request)) {
    return login(request, oAuth2Provider);
  }

  return notFoundResponse;
}

function buildGoogleOAuth2ProviderFromEnv() {
  const googleOAuth2Client = new google.auth.OAuth2(
    process.env.EARTHDATA_CLIENT_ID,
    process.env.EARTHDATA_CLIENT_PASSWORD,
    process.env.API_ENDPOINT
  );

  const googlePlusPeopleClient = google.plus('v1').people;

  return new GoogleOAuth2(googleOAuth2Client, googlePlusPeopleClient);
}

function buildEarthdataLoginProviderFromEnv() {
  return new EarthdataLogin({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    earthdataLoginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri: process.env.API_ENDPOINT
  });
}

function buildOAuth2ProviderFromEnv() {
  return process.env.OAUTH_PROVIDER === 'google'
    ? buildGoogleOAuth2ProviderFromEnv()
    : buildEarthdataLoginProviderFromEnv();
}

async function handleApiGatewayRequest(request) {
  const oAuth2Provider = buildOAuth2ProviderFromEnv();

  return handleRequest(request, oAuth2Provider);
}

module.exports = {
  handleRequest,
  handleApiGatewayRequest
};
