'use strict';

const get = require('lodash/get');
const log = require('@cumulus/common/log');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { google } = require('googleapis');
const {
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');
const { EarthdataLoginClient } = require('@cumulus/oauth-client');
const {
  TokenUnauthorizedUserError,
} = require('../lib/errors');

const GoogleOAuth2 = require('../lib/GoogleOAuth2');
const {
  createJwtToken,
} = require('../lib/token');

const { verifyJwtAuthorization } = require('../lib/request');

const { AccessToken } = require('../lib/access-tokens');

const buildPermanentRedirectResponse = (location, response) =>
  response
    .status(307)
    .set({ Location: location })
    .send('Redirecting');

/**
 * Handle API response for JWT verification errors
 *
 * @param {Error} err - error thrown by JWT verification
 * @param {Object} response - an express response object
 * @returns {Promise<Object>} the promise of express response object
 */
function handleJwtVerificationError(err, response) {
  if (err instanceof TokenExpiredError) {
    return response.boom.unauthorized('Access token has expired');
  }
  if (err instanceof JsonWebTokenError) {
    return response.boom.unauthorized('Invalid access token');
  }
  if (err instanceof TokenUnauthorizedUserError) {
    return response.boom.unauthorized('User not authorized');
  }
  throw err;
}

/**
 * Handles token requests
 *
 * @param {Object} event - an express request object
 * @param {Object} oAuth2Provider - an oAuth provider object
 * @param {Object} response - an express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function token(event, oAuth2Provider, response) {
  const code = get(event, 'query.code');
  const state = get(event, 'query.state');

  // Code contains the value from the Earthdata Login redirect. We use it to get a token.
  if (code) {
    try {
      const {
        accessToken,
        refreshToken,
        username,
        expirationTime,
      } = await oAuth2Provider.getAccessToken(code);

      const accessTokenModel = new AccessToken();

      await accessTokenModel.create({
        accessToken,
        refreshToken,
        expirationTime,
      });

      const jwtToken = createJwtToken({ accessToken, username, expirationTime });

      if (state) {
        return buildPermanentRedirectResponse(
          `${decodeURIComponent(state)}?token=${jwtToken}`,
          response
        );
      }
      log.info('Log info: No state specified, responding 200');
      return response.send({ message: { token: jwtToken } });
    } catch (error) {
      if (error.statusCode === 400) {
        return response.boom.unauthorized('Failed to get authorization token');
      }

      log.error('Error caught when checking code', error);
      return response.boom.unauthorized(error.message);
    }
  }

  const errorMessage = 'Request requires a code';
  return response.boom.unauthorized(errorMessage);
}

/**
 * Handle refreshing tokens with OAuth provider
 *
 * @param {Object} request - an API Gateway request
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @param {Object} response - an API Gateway response object
 * @returns {Object} an API Gateway response
 */
async function refreshAccessToken(request, oAuth2Provider, response) {
  const requestJwtToken = get(request, 'body.token');

  if (!requestJwtToken) {
    return response.boom.unauthorized('Request requires a token');
  }

  let accessToken;
  try {
    accessToken = await verifyJwtAuthorization(requestJwtToken);
  } catch (error) {
    return handleJwtVerificationError(error, response);
  }

  const accessTokenModel = new AccessToken();

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return response.boom.unauthorized('Invalid access token');
    }
  }

  let newAccessToken;
  let newRefreshToken;
  let expirationTime;
  let username;
  try {
    ({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      username,
      expirationTime,
    } = await oAuth2Provider.refreshAccessToken(accessTokenRecord.refreshToken));
  } finally {
    // Delete old token record to prevent refresh with old tokens
    await accessTokenModel.delete({
      accessToken: accessTokenRecord.accessToken,
    });
  }

  // Store new token record
  await accessTokenModel.create({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expirationTime,
  });

  const jwtToken = createJwtToken({ accessToken: newAccessToken, username, expirationTime });
  return response.send({ token: jwtToken });
}

/**
 * Handle token deletion
 *
 * @param {Object} request - an express request object
 * @param {Object} response - an express request object
 * @returns {Promise<Object>} a promise of an express response
 */
async function deleteTokenEndpoint(request, response) {
  const requestJwtToken = get(request.params, 'token');

  if (!requestJwtToken) {
    return response.boom.unauthorized('Request requires a token');
  }

  let accessToken;
  try {
    accessToken = await verifyJwtAuthorization(requestJwtToken);
  } catch (error) {
    return handleJwtVerificationError(error, response);
  }

  const accessTokenModel = new AccessToken();

  await accessTokenModel.delete({ accessToken });

  return response.send({ message: 'Token record was deleted' });
}

/**
 * Handle client authorization
 *
 * @param {Object} request - an express request object
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @param {Object} response - an express request object
 * @returns {Promise<Object>} a promise of an express response
 */
async function login(request, oAuth2Provider, response) {
  const code = get(request, 'query.code');
  const state = get(request, 'query.state');

  if (code) {
    return await token(request, oAuth2Provider, response);
  }

  const authorizationUrl = oAuth2Provider.getAuthorizationUrl(state);
  return buildPermanentRedirectResponse(authorizationUrl, response);
}

function buildGoogleOAuth2ProviderFromEnv() {
  const googleOAuth2Client = new google.auth.OAuth2(
    process.env.EARTHDATA_CLIENT_ID,
    process.env.EARTHDATA_CLIENT_PASSWORD,
    process.env.TOKEN_REDIRECT_ENDPOINT
  );

  const googlePlusPeopleClient = google.people('v1');

  return new GoogleOAuth2(googleOAuth2Client, googlePlusPeopleClient);
}

function buildEarthdataLoginProviderFromEnv() {
  return new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    loginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri: process.env.TOKEN_REDIRECT_ENDPOINT,
  });
}

function buildOAuth2ProviderFromEnv() {
  return process.env.OAUTH_PROVIDER === 'google'
    ? buildGoogleOAuth2ProviderFromEnv()
    : buildEarthdataLoginProviderFromEnv();
}

/**
 * performs OAuth against an OAuth provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function tokenEndpoint(req, res) {
  const oAuth2Provider = buildOAuth2ProviderFromEnv();
  return await login(req, oAuth2Provider, res);
}

/**
 * refreshes an OAuth token
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function refreshEndpoint(req, res) {
  const oAuth2Provider = buildOAuth2ProviderFromEnv();
  return await refreshAccessToken(req, oAuth2Provider, res);
}

module.exports = {
  refreshEndpoint,
  tokenEndpoint,
  deleteTokenEndpoint,
};
