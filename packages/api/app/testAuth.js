'use strict';

const { randomString } = require('@cumulus/common/test-utils');
const get = require('lodash.get');
const { verifyJwtToken } = require('../lib/token');

let token = randomString();

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
  if (token == '') token = randomString();

  if (code) {
    if (state) {
      return res
        .status(307)
        .set({ Location: `${decodeURIComponent(state)}?token=${token}` })
        .send('Redirecting');
    }
    return res.send({
      message: {
        token
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
      token
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
  token = '';
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

  if (jwtToken === token) {
    req.authorizedMetadata = { userName: 'testUser' };
    return next();
  }
  return res.boom.unauthorized('User not authorized');
}

module.exports = {
  tokenEndpoint,
  refreshEndpoint,
  deleteTokenEndpoint,
  token,
  ensureAuthorized
};
