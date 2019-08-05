
'use strict';

const { AccessToken } = require('../models');
const LaunchpadToken = require('@cumulus/common/LaunchpadToken');

function checkUserGroups(userGroups) {
  const cumulusGroup = process.env.cumulusUserGroup;
  userGroups.forEach((group) => {
    if (group.includes(cumulusGroup)) return true;
  });
  return false;
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
  // Parse the Authorization header
  const [scheme, token] = req.headers.authorization.trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    return res.boom.unauthorized('Authorization scheme must be Bearer');
  }

  if (!token) {
    return res.boom.unauthorized('Missing token');
  }

  const userModel = new User();
  const access = new AccessToken();

  // await userModel.get({ userName });
  let accessToken = await access.get({ token });
    
  if (accessToken) {
    const user = accessToken.username;
    if (expirationTime < Date.now()) {
      throw new TokenExpiredError;
    } else {
      // Adds additional metadata that authorized endpoints can access.
      req.authorizedMetadata = { userName: user };    
      return next();
    }
  } else {
    const launchpadToken = new LaunchpadToken(); //Needs config
    const verifyResponse = launchpadToken.validateToken(token);

    // "status" : "success",
// [ "cn=GSFC-CMR_INGEST_PROD\ ,ou=252398,ou=ROLES,ou=Groups,dc=nasa,dc=gov",
// "cn=CMR_INGEST_UAT,ou=252397,ou=ROLES,ou=Groups,dc=nasa,dc=gov" ]
// cn=GSFC-Cumulus-Dev

    if (verifyResponse.status === "success") {
      if (checkUserGroups(verifyResponse.owner_groups)) {
        await accessTokenModel.create({
          accessToken,
          expirationTime: Date.now() + 3600,
          username: owner_auid
        });

        return next();
      }
      return res.boom.forbidden('User not authorized');
    } else {
      return res.boom.forbidden('Invalid access token');
    }
  }
}

module.exports = {
  ensureAuthorized
};
