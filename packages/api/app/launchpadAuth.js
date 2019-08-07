
'use strict';

const LaunchpadToken = require('@cumulus/common/LaunchpadToken');
const { RecordDoesNotExist } = require('@cumulus/common/errors');
const { AccessToken } = require('../models');

function checkUserGroups(userGroups) {
  const cumulusGroup = process.env.cumulusUserGroup;
  let included;
  userGroups.forEach((group) => {
    if (group.includes(cumulusGroup)) included = true;
  });
  return included;
}

/**
 * An express middleware that checks if an incoming express
 * request is authenticated via Launchpad
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
      const config = {
        api: process.env.launchpad_api,
        passphrase: process.env.launchpad_passphrase,
        certificate: process.env.launchpad_certificate
      };

      const launchpadToken = new LaunchpadToken(config);
      const verifyResponse = await launchpadToken.validateToken(token);

      if (verifyResponse.status === 'success') {
        if (checkUserGroups(verifyResponse.owner_groups)) {
          await access.create({
            accessToken: token,
            expirationTime: Date.now() + (verifyResponse.session_maxtimeout * 1000),
            username: verifyResponse.owner_auid
          });

          req.authorizedMetadata = { userName: verifyResponse.owner_auid };
          return next();
        }
        return res.boom.forbidden('User not authorized');
      }
      return res.boom.forbidden('Invalid access token');
    }
  }
  return res.boom.unauthorized('User not authorized');
}

module.exports = {
  ensureAuthorized
};
