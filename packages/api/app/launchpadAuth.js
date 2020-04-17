'use strict';

const launchpad = require('@cumulus/launchpad-auth');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { AccessToken } = require('../models');

const launchpadProtectedAuth = () => (process.env.OAUTH_PROVIDER === 'launchpad');

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
  const access = new AccessToken();
  let accessToken;
  try {
    accessToken = await access.get({ accessToken: token });

    if (accessToken) {
      const userName = accessToken.username;
      if (Date.now() > accessToken.expirationTime) {
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
        certificate: process.env.launchpad_certificate
      };

      const userGroup = process.env.oauth_user_group;
      const verifyResponse = await launchpad.validateLaunchpadToken(config, token, userGroup);

      if (verifyResponse.status === 'success') {
        await access.create({
          accessToken: token,
          expirationTime: Date.now() + (verifyResponse.session_maxtimeout * 1000),
          username: verifyResponse.owner_auid
        });

        req.authorizedMetadata = { userName: verifyResponse.owner_auid };
        return next();
      }
      return res.boom.forbidden(verifyResponse.message);
    }
  }
  return res.boom.unauthorized('User not authorized');
}

module.exports = {
  ensureLaunchpadAPIAuthorized,
  launchpadProtectedAuth
};
