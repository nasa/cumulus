'use strict';

const {
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');
const moment = require('moment');

const launchpad = require('@cumulus/launchpad-auth');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const log = require('@cumulus/common/log');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { isAccessTokenExpired, verifyJwtToken } = require('../lib/token');
const { AccessToken } = require('../models');

const launchpadProtectedAuth = () => (process.env.OAUTH_PROVIDER === 'launchpad');

const ensureValidCustomLaunchpadToken = async (req, res, next) => {
  const token = req.headers.authorization.trim().split(/\s+/)[1];

  const accessTokenModel = new AccessToken();

  try {
    const accessTokenRecord = await accessTokenModel.get({ accessToken: token });

    if (accessTokenRecord) {
      const userName = accessTokenRecord.username;
      if (isAccessTokenExpired(accessTokenRecord)) {
        return res.boom.unauthorized('Access token has expired');
      }
      // Adds additional metadata that authorized endpoints can access.
      req.authorizedMetadata = { userName };
      return next();
    }
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      const passphrase = await getSecretString(
        process.env.launchpad_passphrase_secret_name
      );

      const config = {
        passphrase,
        api: process.env.launchpad_api,
        certificate: process.env.launchpad_certificate,
      };

      const userGroup = process.env.oauth_user_group;
      const verifyResponse = await launchpad.validateLaunchpadToken(config, token, userGroup);

      if (verifyResponse.status === 'success') {
        await accessTokenModel.create({
          accessToken: token,
          expirationTime: moment().unix() + verifyResponse.session_maxtimeout,
          username: verifyResponse.owner_auid,
        });

        req.authorizedMetadata = { userName: verifyResponse.owner_auid };
        return next();
      }
      return res.boom.forbidden(verifyResponse.message);
    }
  }
  return res.boom.unauthorized('User not authorized');
};

/**
 * An express middleware that checks if an incoming express
 * request is authenticated via Launchpad
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function ensureLaunchpadAPIAuthorized(req, res, next) {
  // Verify that the Authorization header was set in the request
  const authorizationKey = req.headers.authorization;
  if (!authorizationKey) {
    return res.boom.unauthorized('Authorization header missing');
  }
  // Parse the Authorization header
  const [scheme, token] = req.headers.authorization.trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    return res.boom.unauthorized('Authorization scheme must be Bearer');
  }

  if (!token) {
    return res.boom.unauthorized('Missing token');
  }

  try {
    const { username: userName, accessToken } = verifyJwtToken(token);

    const accessTokenModel = new AccessToken();
    await accessTokenModel.get({ accessToken });

    // Adds additional metadata that authorized endpoints can access.
    req.authorizedMetadata = { userName };
    return next();
  } catch (error) {
    if (error instanceof JsonWebTokenError
        && error.message === 'jwt malformed') {
      return ensureValidCustomLaunchpadToken(req, res, next);
    }

    if (error instanceof TokenExpiredError) {
      return res.boom.unauthorized('Access token has expired');
    }

    if (error instanceof JsonWebTokenError) {
      return res.boom.unauthorized('Invalid access token');
    }

    log.error('Authorization error:', error);
    return res.boom.unauthorized('User not authorized');
  }
}

module.exports = {
  ensureLaunchpadAPIAuthorized,
  launchpadProtectedAuth,
};
