'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');

const { google } = require('googleapis');
const { JsonWebTokenError, TokenExpiredError } = require('jsonwebtoken');

const EarthdataLogin = require('../lib/EarthdataLogin');
const GoogleOAuth2 = require('../lib/GoogleOAuth2');
const {
  createJwtToken,
  verifyJwtToken
} = require('../lib/token');

const { AccessToken, User } = require('../models');

const buildPermanentRedirectResponse = (location, response) =>
  response
    .set({ Location: location })
    .status(307)
    .send('Redirecting');

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
        expirationTime
      } = await oAuth2Provider.getAccessToken(code);

      const accessTokenModel = new AccessToken();

      await accessTokenModel.create({
        accessToken,
        refreshToken
      });

      const jwtToken = createJwtToken({ accessToken, username, expirationTime });

      if (state) {
        log.info(`Log info: Redirecting to state: ${state} with token ${jwtToken}`);
        return buildPermanentRedirectResponse(
          `${decodeURIComponent(state)}?token=${jwtToken}`,
          response
        );
      }
      log.info('Log info: No state specified, responding 200');
      return response.send({ message: { token: jwtToken } })
    }
    catch (e) {
      if (e.statusCode === 400) {
        return response.boom.unauthorized('Failed to get authorization token');
      }

      log.error('Error caught when checking code', e);
      return response.boom.unauthorized(e.message);
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
 * @returns {Object} an API Gateway response
 */
async function refreshAccessToken(request, oAuth2Provider, response) {
  const requestJwtToken = get(request, 'body.token');

  if (requestJwtToken) {
    let accessToken;
    let username;
    try {
      ({ accessToken, username } = verifyJwtToken(requestJwtToken));
    }
    catch (err) {
      if (err instanceof TokenExpiredError) {
        return response.boom.forbidden('Access token has expired');
      }
      if (err instanceof JsonWebTokenError) {
        return response.boom.forbidden('Invalid access token');
      }
    }

    const userModel = new User();
    try {
      await userModel.get({ userName: username });
    }
    catch (err) {
      if (err.name === 'RecordDoesNotExist') {
        return response.boom.forbidden('User not authorized');
      }
    }

    const accessTokenModel = new AccessToken();

    let accessTokenRecord;
    try {
      accessTokenRecord = await accessTokenModel.get({ accessToken });
    }
    catch (err) {
      if (err.name === 'RecordDoesNotExist') {
        return response.boom.forbidden('Invalid access token');
      }
    }

    let newAccessToken;
    let newRefreshToken;
    let expirationTime;
    try {
      ({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        username,
        expirationTime
      } = await oAuth2Provider.refreshAccessToken(accessTokenRecord.refreshToken));
    }
    catch (error) {
      log.error('Error caught when attempting token refresh', error);
      return response.boom.badImplementation('Internal Server Error') 
    }
    finally {
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
    return response.send({ token: jwtToken });
  }

  const errorMessage = 'Request requires a token';
  return response.boom.badRequest(errorMessage);
}

/**
 * Handle client authorization
 *
 * @param {Object} request - an API Gateway request
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @returns {Object} an API Gateway response
 */
async function login(request, oAuth2Provider, response) {
  const code = get(request, 'query.code');
  const state = get(request, 'query.state');

  if (code) {
    return token(request, oAuth2Provider, response);
  }

  const authorizationUrl = oAuth2Provider.getAuthorizationUrl(state);
  console.log(authorizationUrl)
  return buildPermanentRedirectResponse(authorizationUrl, response);
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

/**
 * performs OAuth against an OAuth provider 
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object 
 */
async function tokenEndpoint(req, res) {
  const oAuth2Provider = buildOAuth2ProviderFromEnv();
  return login(req, oAuth2Provider, res)
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
  return refreshAccessToken(req, oAuth2Provider, res)
}

module.exports = {
  refreshEndpoint,
  tokenEndpoint
};
