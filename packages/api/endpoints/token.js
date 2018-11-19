'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');

const { google } = require('googleapis');
const { decode: jwtDecode, JsonWebTokenError } = require('jsonwebtoken');

const EarthdataLogin = require('../lib/EarthdataLogin');
const GoogleOAuth2 = require('../lib/GoogleOAuth2');
const {
  createJwtToken,
  verifyJwtToken
} = require('../lib/token');

const { AccessToken } = require('../models');
const {
  AuthorizationFailureResponse,
  LambdaProxyResponse,
  InternalServerError,
  InvalidTokenResponse
} = require('../lib/responses');

const buildPermanentRedirectResponse = (location) =>
  new LambdaProxyResponse({
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
        refreshToken,
        username,
        expirationTime
      } = await oAuth2Provider.getAccessToken(code);

      // todo: check if user has access before returning token?

      const accessTokenModel = new AccessToken();

      await accessTokenModel.create({
        accessToken,
        refreshToken,
      });

      const jwtToken = createJwtToken({ accessToken, username, expirationTime });

      if (state) {
        // log.info(`Log info: Redirecting to state: ${state} with token ${jwtToken}`);
        return buildPermanentRedirectResponse(
          `${decodeURIComponent(state)}?token=${jwtToken}`
        );
      }
      log.info('Log info: No state specified, responding 200');
      return new LambdaProxyResponse({
        json: true,
        statusCode: 200,
        body: { message: { token: jwtToken } }
      });
    }
    catch (e) {
      if (e.statusCode === 400) {
        return new AuthorizationFailureResponse({
          error: 'authorization_failure',
          message: 'Failed to get authorization token'
        });
      }

      log.error('Error caught when checking code:', e);
      return new AuthorizationFailureResponse({ error: e, message: e.message });
    }
  }

  const errorMessage = 'Request requires a code';
  const error = new Error(errorMessage);
  return new AuthorizationFailureResponse({ error: error, message: error.message });
}

/**
 * Handle refreshing tokens with OAuth provider
 *
 * @param {Object} request - an API Gateway request
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @returns {Object} an API Gateway response
 */
async function refreshToken(request, oAuth2Provider) {
  const body = request.body
    ? JSON.parse(request.body)
    : {};
  const requestJwtToken = get(body, 'token');

  if (requestJwtToken) {
    try {
      verifyJwtToken(requestJwtToken, { ignoreExpiration: true });
    } catch (err) {
      if (err instanceof JsonWebTokenError) {
        return new InvalidTokenResponse();
      }
    }

    const { accessToken } = jwtDecode(requestJwtToken);

    const accessTokenModel = new AccessToken();

    let accessTokenRecord;
    try {
      accessTokenRecord = await accessTokenModel.get({ accessToken });
    } catch (err) {
      if (err.name === 'RecordDoesNotExist') {
        return new InvalidTokenResponse();
      }
    }

    let newAccessToken;
    let newRefreshToken;
    let username;
    let expirationTime;
    try {
      ({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        username,
        expirationTime
      } = await oAuth2Provider.refreshAccessToken(accessTokenRecord.refreshToken));
    } catch (error) {
      log.error('Error caught when attempting token refresh', error);
      return new InternalServerError();
    } finally {
      // Delete old token record to prevent refresh with old tokens
      await accessTokenModel.delete({
        accessToken: accessTokenRecord.accessToken
      });
    }

    // Store new token record
    await accessTokenModel.create({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });

    const jwtToken = createJwtToken({ accessToken: newAccessToken, username, expirationTime });
    return new LambdaProxyResponse({
      json: true,
      statusCode: 200,
      body: { token: jwtToken }
    });
  }

  const errorMessage = 'Request requires a token';
  const error = new Error(errorMessage);
  return new AuthorizationFailureResponse({
    statusCode: 400,
    error: error,
    message: error.message
  });
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

const isTokenRefreshRequest = (request) =>
  request.httpMethod === 'POST'
  && request.resource.endsWith('/refresh');

const notFoundResponse = new LambdaProxyResponse({
  json: false,
  statusCode: 404,
  body: 'Not found'
});

async function handleRequest(request, oAuth2Provider) {
  if (isGetTokenRequest(request)) {
    return login(request, oAuth2Provider);
  } else if (isTokenRefreshRequest(request)) {
    return refreshToken(request, oAuth2Provider);
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
