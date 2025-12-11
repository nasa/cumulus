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
// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');
const {
  TokenUnauthorizedUserError,
} = require('../lib/errors');

const GoogleOAuth2 = require('../lib/GoogleOAuth2');
const {
  createJwtToken,
} = require('../lib/token');

const { verifyJwtAuthorization } = require('../lib/request');

const { AccessToken } = require('../models');

// Get the tracer
const tracer = trace.getTracer('cumulus-api');

const buildPermanentRedirectResponse = (location, response) =>
  response
    .status(307)
    .set({ Location: location })
    .send('Redirecting');

/**
 * Handle API response for JWT verification errors
 *
 * @param {Error} err - error thrown by JWT verification
 * @param {object} response - an express response object
 * @returns {Promise<object>} the promise of express response object
 */
function handleJwtVerificationError(err, response) {
  return tracer.startActiveSpan('handleJwtVerificationError', (span) => {
    try {
      span.setAttribute('error.type', err.constructor.name);

      if (err instanceof TokenExpiredError) {
        span.setAttribute('jwt.error', 'expired');
        return response.boom.unauthorized('Access token has expired');
      }
      if (err instanceof JsonWebTokenError) {
        span.setAttribute('jwt.error', 'invalid');
        return response.boom.unauthorized('Invalid access token');
      }
      if (err instanceof TokenUnauthorizedUserError) {
        span.setAttribute('jwt.error', 'unauthorized');
        return response.boom.unauthorized('User not authorized');
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Handles token requests
 *
 * @param {object} event - an express request object
 * @param {object} oAuth2Provider - an oAuth provider object
 * @param {object} response - an express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function token(event, oAuth2Provider, response) {
  return await tracer.startActiveSpan('token', async (span) => {
    try {
      const code = get(event, 'query.code');
      const state = get(event, 'query.state');

      span.setAttribute('oauth.code.present', !!code);
      span.setAttribute('oauth.state.present', !!state);

      // Code contains the value from the Earthdata Login redirect. We use it to get a token.
      if (code) {
        try {
          let accessToken;
          let refreshToken;
          let username;
          let expirationTime;

          // Use callback pattern to get span
          await tracer.startActiveSpan('oAuth2Provider.getAccessToken', async (accessTokenSpan) => {
            try {
              ({
                accessToken,
                refreshToken,
                username,
                expirationTime,
              } = await oAuth2Provider.getAccessToken(code));
              accessTokenSpan.setAttribute('oauth.username', username);
            } finally {
              accessTokenSpan.end();
            }
          });

          const accessTokenModel = new AccessToken();

          // Use callback pattern to get span
          await tracer.startActiveSpan('accessTokenModel.create', async (createSpan) => {
            try {
              await accessTokenModel.create({
                accessToken,
                refreshToken,
                expirationTime,
              });
            } finally {
              createSpan.end();
            }
          });

          const jwtToken = createJwtToken({ accessToken, username, expirationTime });

          if (state) {
            span.setAttribute('response.type', 'redirect');
            return buildPermanentRedirectResponse(
              `${decodeURIComponent(state)}?token=${jwtToken}`,
              response
            );
          }

          log.info('Log info: No state specified, responding 200');
          span.setAttribute('response.type', 'direct');
          return response.send({ message: { token: jwtToken } });
        } catch (error) {
          span.recordException(error);
          span.setAttribute('error', true);

          if (error.statusCode === 400) {
            return response.boom.unauthorized('Failed to get authorization token');
          }

          log.error('Error caught when checking code', error);
          return response.boom.unauthorized(error.message);
        }
      }

      const errorMessage = 'Request requires a code';
      span.setAttribute('error', true);
      span.setAttribute('error.message', errorMessage);
      return response.boom.unauthorized(errorMessage);
    } finally {
      span.end();
    }
  });
}

/**
 * Handle refreshing tokens with OAuth provider
 *
 * @param {object} request - an API Gateway request
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @param {object} response - an API Gateway response object
 * @returns {object} an API Gateway response
 */
async function refreshAccessToken(request, oAuth2Provider, response) {
  return await tracer.startActiveSpan('refreshAccessToken', async (span) => {
    try {
      const requestJwtToken = get(request, 'body.token');

      if (!requestJwtToken) {
        span.setAttribute('error', true);
        span.setAttribute('error.message', 'Missing token');
        return response.boom.unauthorized('Request requires a token');
      }

      let accessToken;
      try {
        await tracer.startActiveSpan('verifyJwtAuthorization', async (verifySpan) => {
          try {
            accessToken = await verifyJwtAuthorization(requestJwtToken);
          } finally {
            verifySpan.end();
          }
        });
      } catch (error) {
        span.recordException(error);
        return handleJwtVerificationError(error, response);
      }

      const accessTokenModel = new AccessToken();

      let accessTokenRecord;
      try {
        await tracer.startActiveSpan('accessTokenModel.get', async (getSpan) => {
          try {
            accessTokenRecord = await accessTokenModel.get({ accessToken });
          } finally {
            getSpan.end();
          }
        });
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('error', true);
          span.setAttribute('error.type', 'RecordDoesNotExist');
          return response.boom.unauthorized('Invalid access token');
        }
        throw error;
      }

      let newAccessToken;
      let newRefreshToken;
      let expirationTime;
      let username;

      try {
        await tracer.startActiveSpan('oAuth2Provider.refreshAccessToken', async (refreshSpan) => {
          try {
            ({
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              username,
              expirationTime,
            } = await oAuth2Provider.refreshAccessToken(accessTokenRecord.refreshToken));
            refreshSpan.setAttribute('oauth.username', username);
          } finally {
            refreshSpan.end();
          }
        });
      } finally {
        // Delete old token record to prevent refresh with old tokens
        await tracer.startActiveSpan('accessTokenModel.delete.old', async (deleteSpan) => {
          try {
            await accessTokenModel.delete({
              accessToken: accessTokenRecord.accessToken,
            });
          } finally {
            deleteSpan.end();
          }
        });
      }

      // Store new token record
      await tracer.startActiveSpan('accessTokenModel.create', async (createSpan) => {
        try {
          await accessTokenModel.create({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expirationTime,
          });
        } finally {
          createSpan.end();
        }
      });

      const jwtToken = createJwtToken({ accessToken: newAccessToken, username, expirationTime });
      return response.send({ token: jwtToken });
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Handle token deletion
 *
 * @param {object} request - an express request object
 * @param {object} response - an express request object
 * @returns {Promise<object>} a promise of an express response
 */
async function deleteTokenEndpoint(request, response) {
  return await tracer.startActiveSpan('deleteTokenEndpoint', async (span) => {
    try {
      const requestJwtToken = get(request.params, 'token');

      if (!requestJwtToken) {
        span.setAttribute('error', true);
        span.setAttribute('error.message', 'Missing token');
        return response.boom.unauthorized('Request requires a token');
      }

      let accessToken;
      try {
        await tracer.startActiveSpan('verifyJwtAuthorization', async (verifySpan) => {
          try {
            accessToken = await verifyJwtAuthorization(requestJwtToken);
          } finally {
            verifySpan.end();
          }
        });
      } catch (error) {
        span.recordException(error);
        return handleJwtVerificationError(error, response);
      }

      const accessTokenModel = new AccessToken();

      await tracer.startActiveSpan('accessTokenModel.delete', async (deleteSpan) => {
        try {
          await accessTokenModel.delete({ accessToken });
        } finally {
          deleteSpan.end();
        }
      });

      return response.send({ message: 'Token record was deleted' });
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Handle client authorization
 *
 * @param {object} request - an express request object
 * @param {OAuth2} oAuth2Provider - an OAuth2 instance
 * @param {object} response - an express request object
 * @returns {Promise<object>} a promise of an express response
 */
async function login(request, oAuth2Provider, response) {
  return await tracer.startActiveSpan('login', async (span) => {
    try {
      const code = get(request, 'query.code');
      const state = get(request, 'query.state');

      span.setAttribute('oauth.code.present', !!code);
      span.setAttribute('oauth.state.present', !!state);

      if (code) {
        return await token(request, oAuth2Provider, response);
      }

      const authorizationUrl = oAuth2Provider.getAuthorizationUrl(state);
      span.setAttribute('response.type', 'redirect_to_oauth');
      return buildPermanentRedirectResponse(authorizationUrl, response);
    } finally {
      span.end();
    }
  });
}

/**
 *
 */
function buildGoogleOAuth2ProviderFromEnv() {
  const googleOAuth2Client = new google.auth.OAuth2(
    process.env.EARTHDATA_CLIENT_ID,
    process.env.EARTHDATA_CLIENT_PASSWORD,
    process.env.TOKEN_REDIRECT_ENDPOINT
  );

  const googlePlusPeopleClient = google.people('v1');

  return new GoogleOAuth2(googleOAuth2Client, googlePlusPeopleClient);
}

/**
 *
 */
function buildEarthdataLoginProviderFromEnv() {
  return new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    loginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri: process.env.TOKEN_REDIRECT_ENDPOINT,
  });
}

/**
 *
 */
function buildOAuth2ProviderFromEnv() {
  return process.env.OAUTH_PROVIDER === 'google'
    ? buildGoogleOAuth2ProviderFromEnv()
    : buildEarthdataLoginProviderFromEnv();
}

/**
 * performs OAuth against an OAuth provider
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function tokenEndpoint(req, res) {
  return await tracer.startActiveSpan('tokenEndpoint', async (span) => {
    try {
      const oAuth2Provider = buildOAuth2ProviderFromEnv();
      span.setAttribute('oauth.provider', process.env.OAUTH_PROVIDER || 'earthdata');
      return await login(req, oAuth2Provider, res);
    } finally {
      span.end();
    }
  });
}

/**
 * refreshes an OAuth token
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function refreshEndpoint(req, res) {
  return await tracer.startActiveSpan('refreshEndpoint', async (span) => {
    try {
      const oAuth2Provider = buildOAuth2ProviderFromEnv();
      span.setAttribute('oauth.provider', process.env.OAUTH_PROVIDER || 'earthdata');
      return await refreshAccessToken(req, oAuth2Provider, res);
    } finally {
      span.end();
    }
  });
}

module.exports = {
  refreshEndpoint,
  tokenEndpoint,
  deleteTokenEndpoint,
};
