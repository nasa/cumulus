'use strict';

const { randomId } = require('@cumulus/common/test-utils');
const get = require('lodash.get');
const { createJwtToken } = require('../lib/token');

let accessToken = randomId('oauthcode');
const username = 'testUser';
const expirationTime = new Date(Date.now() + 3600 * 24 * 1000);
const jwt = createJwtToken({ accessToken, username, expirationTime });

/**
 * performs OAuth against an OAuth provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function tokenEndpoint(req, res) {
  const code = get(req, 'query.code');
  const state = get(req, 'query.state');
  if (accessToken === '') accessToken = randomId('oauthcode');

  if (code) {
    if (state) {
      return res
        .status(307)
        .set({ Location: `${decodeURIComponent(state)}?token=${jwt}` })
        .send('Redirecting');
    }
    return res.send({
      message: {
        token: jwt
      }
    });
  }

  let uri = `${process.env.TOKEN_REDIRECT_ENDPOINT}?code=somecode`;
  if (state) {
    uri += `&state=${encodeURIComponent(state)}`;
  }

  return res
    .status(307)
    .set({ Location: uri })
    .send('Redirecting');
}

/**
 * refreshes an OAuth token
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function refreshEndpoint(req, res) {
  return res.send({
    message: {
      token: jwt
    }
  });
}

/**
 * Handle token deletion
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} a promise of an express response
 */
async function deleteTokenEndpoint(req, res) {
  accessToken = '';
  return res.send({ message: 'Token record was deleted' });
}

/**
 * An express middleware that checks if an incoming express
 * request is authenticated
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function ensureAuthorized(req, res, next) {
  // Verify that the Authorization header was set in the request
  const authorizationKey = req.headers.authorization;
  if (!authorizationKey) {
    return res.boom.unauthorized('Authorization header missing');
  }
  const jwtToken = req.headers.authorization.trim().split(/\s+/)[1];

  if (!jwtToken) {
    return res.boom.unauthorized('Missing token');
  }

  if (jwtToken === jwt) {
    req.authorizedMetadata = { userName: username };
    return next();
  }
  return res.boom.unauthorized('User not authorized');
}

module.exports = {
  tokenEndpoint,
  refreshEndpoint,
  deleteTokenEndpoint,
  ensureAuthorized
};
