'use strict';

const saml2 = require('saml2-js');
const got = require('got');
const path = require('path');
const { JSONPath } = require('jsonpath-plus');
const { parseString } = require('xml2js');
const { promisify } = require('util');
const get = require('lodash/get');
const moment = require('moment');
const {
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');

const {
  getS3Object,
  parseS3Uri,
  s3ObjectExists,
  s3PutObject,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { AccessToken } = require('../models');
const { createJwtToken } = require('../lib/token');
const { verifyJwtAuthorization } = require('../lib/request');
const {
  TokenUnauthorizedUserError,
} = require('../lib/errors');

const parseXmlString = promisify(parseString);

/**
 * launchpad idp metadata s3 uri
 * @returns {string} - s3 location of launchpad idp metadata
 */
const launchpadMetadataS3Uri = () => (
  `s3://${process.env.system_bucket}/${process.env.stackName}/crypto/launchpadMetadata.xml`
);

/**
 * download launchpad's idp metadata to s3
 *
 * @param {string} launchpadPublicMetadataPath - launchpad metadata s3 uri
 * @returns {Promise<undefined>} resolves when the file has been downloaded
 */
const downloadLaunchpadPublicMetadata = async (launchpadPublicMetadataPath) => {
  const launchpadMetadataUrl = process.env.LAUNCHPAD_METADATA_URL;
  const { Bucket, Key } = parseS3Uri(launchpadPublicMetadataPath);
  try {
    const urlResponse = await got.get(launchpadMetadataUrl);
    const launchpadMetadataFromUrl = urlResponse.body;
    const params = { Bucket, Key, Body: launchpadMetadataFromUrl };
    await s3PutObject(params);
    log.debug('Downloaded the launchpad metadata to s3');
  } catch (error) {
    error.message = `Unable to download the launchpad metadata to s3 ${error}`;
    throw error;
  }
};

/**
 * reads public metadata file from S3 path and returns the X509Certificate value
 *
 * The XML file is a copy of the launchpad's idp metadata found here for the sandbox
 * https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml
 *
 * @param {string} launchpadPublicMetadataPath - launchpad metadata s3 uri
 * @returns {Promise<Array>} Array containing the X509Certificate from the input metadata file.
 */
const launchpadPublicCertificate = async (launchpadPublicMetadataPath) => {
  let launchpadMetatdataXML;
  const { Bucket, Key } = parseS3Uri(launchpadPublicMetadataPath);
  try {
    if (!(await s3ObjectExists({ Bucket, Key }))) {
      await downloadLaunchpadPublicMetadata(launchpadPublicMetadataPath);
    }
    const s3Object = await getS3Object(Bucket, Key);
    launchpadMetatdataXML = await getObjectStreamContents(s3Object.Body);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.name === 'NoSuchBucket') {
      error.message = `Cumulus could not find Launchpad public xml metadata at ${launchpadPublicMetadataPath}`;
    }
    throw error;
  }

  const metadata = await parseXmlString(launchpadMetatdataXML);
  // matches path such as ['ns1:KeyInfo'][0]['ns1:X509Data'][0]['ns1:X509Certificate']
  const searchPath = '$..[?(@path.endsWith("[\'X509Certificate\']") || @path.endsWith(":X509Certificate\']"))]';
  const certificates = JSONPath(searchPath, metadata);
  if (certificates.length >= 1) return certificates.pop();
  throw new Error(
    `Failed to retrieve Launchpad metadata X509 Certificate from ${launchpadPublicMetadataPath}`
  );
};

/**
 * Validates the SAML user Group includes the configured authorized User Group.
 *
 * @param {string} samlUserGroup -  Saml response string e.g.:
       'cn=wrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov'.
 * @param {string} authorizedGroup - Cumulus oauth user group.
 * @returns {boolean} True if samlUserGroup includes the authorizedUserGroup.
 */
const authorizedUserGroup = (samlUserGroup, authorizedGroup) => {
  const matcher = new RegExp(`cn=${authorizedGroup}`);
  return matcher.test(samlUserGroup);
};

/**
 * Retrieve user and session information from SAML response.
 *
 * @param {Object} samlResponse - Post assert object returned from SAML identity provider.
 * @returns {Object} object containing username and accessToken retrieved from SAML response.
 */
const parseSamlResponse = (samlResponse) => {
  let username;
  let accessToken;
  let userGroups;
  try {
    const attributes = samlResponse.user.attributes;
    username = get(attributes, 'UserId', get(attributes, 'UserID'))[0];
    accessToken = samlResponse.user.session_index;
    userGroups = samlResponse.user.attributes.userGroup;
  } catch (error) {
    throw new Error(
      `invalid SAML response received ${JSON.stringify(samlResponse)}`
    );
  }

  const validGroups = userGroups.filter((userGroup) =>
    authorizedUserGroup(userGroup, process.env.oauth_user_group));
  if (validGroups.length === 0) {
    throw new Error(
      `User not authorized for this application ${username} not a member of userGroup: ${process.env.oauth_user_group}`
    );
  }

  return { username, accessToken };
};

/**
 * Store the SAML response's token in the AccessResponse table and return a JWT
 * from the derived values.
 *
 * @param {Object} samlResponse - post_assert response from saml IDP provider
 *
 * @returns {Promise<Object>} - a valid JWT token that can be used for authentication.
 */
const buildLaunchpadJwt = async (samlResponse) => {
  const { username, accessToken } = parseSamlResponse(samlResponse);
  // expires in 1 hour
  const expirationTime = moment().unix() + 60 * 60;
  const accessTokenModel = new AccessToken();
  await accessTokenModel.create({ accessToken, expirationTime, username });
  return createJwtToken({ accessToken, expirationTime, username });
};

/**
 * convenience function to set up SAML Identity and Service Providers
 */
const prepareSamlProviders = async () => {
  const LaunchpadX509Certificate = await launchpadPublicCertificate(launchpadMetadataS3Uri());

  const spOptions = {
    entity_id: process.env.ENTITY_ID,
    assert_endpoint: process.env.ASSERT_ENDPOINT,
    force_authn: false,
    nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    sign_get_request: false,
    allow_unencrypted_assertion: true,
  };

  const idpOptions = {
    sso_login_url: process.env.IDP_LOGIN,
    certificates: LaunchpadX509Certificate,
  };

  const idp = new saml2.IdentityProvider(idpOptions);
  const sp = new saml2.ServiceProvider(spOptions);

  return { idp, sp };
};

/**
 * Starting point for SAML SSO login
 *
 * Creates a login request url for a SAML Identity Provider and redirects to
 * that location.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} response redirect to the Identity Provider.
 */
const login = async (req, res) => {
  const { idp, sp } = await prepareSamlProviders();
  const relayState = req.query.RelayState;
  sp.create_login_request_url(
    idp,
    { relay_state: relayState },
    (err, loginUrl) => {
      if (err) {
        return res.boom.badRequest('Could not create login request url.', err);
      }
      return res.redirect(loginUrl);
    }
  );
};

/**
 *  SAML AssertionConsumerService (ACS) endpoint.
 *
 *  Receives and validates the POSTed response from Identity Provider Service.
 *  Returns to the RelayState url appending a valid samlResponse-based JWT
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} response redirect back to the initiating requests relay
 *                   state with a valid token query parameter.
 */
const auth = async (req, res) => {
  const { idp, sp } = await prepareSamlProviders();
  sp.post_assert(idp, { request_body: req.body }, async (err, samlResponse) => {
    if (err) {
      log.debug(`launchpadSaml.auth post assert error ${err}`);
      if (err.message && err.message.startsWith('SAML Assertion signature check failed!')) {
        return downloadLaunchpadPublicMetadata(launchpadMetadataS3Uri())
          .then(() => res.redirect(`${req.body.RelayState}`));
      }
      return res.boom.badRequest(`SAML post assert error ${err}`, err);
    }

    try {
      const LaunchpadJwtToken = await buildLaunchpadJwt(samlResponse);
      const Location = `${req.body.RelayState}/?token=${LaunchpadJwtToken}`;
      return res.redirect(Location);
    } catch (error) {
      return res.boom.badRequest(`Could not build JWT from SAML response ${error}`, error);
    }
  });
};

/**
 * Helper to pull the incoming URL.
 *
 * @param {string} apiBaseUrl - API base URL
 * @param {string} requestPath - Request path for incoming request
 * @returns {string} - The URL the client visited to generate the request.
 */
const getIncomingUrlFromRequest = (apiBaseUrl, requestPath) => {
  const apiBaseUrlObject = new URL(apiBaseUrl);
  // apiBaseUrlObject.pathname is necessary to handle API URLs that
  // may/may not have an API gateway stage name
  const fullRequestPath = path.join(apiBaseUrlObject.pathname, requestPath);
  return new URL(fullRequestPath, apiBaseUrl).toString();
};

/**
 * SAML Token endpoint.
 *
 * Simply returns the token received as a query parameter or redirects to saml
 * login to authenticate.
 * @param {Object} req - express request
 * @param {Object} res - express response
 * @returns {Object} - Either JWToken presented as a query string in the
 * request or a redirect back to saml/login endpoing to receive the token.
 */
const samlToken = (req, res) => {
  const { token } = req.query;
  if (token) return res.send({ message: { token } });

  let apiBaseUrl;
  let RelayState;
  try {
    apiBaseUrl = process.env.API_BASE_URL;
    if (!apiBaseUrl) {
      throw new Error('API_BASE_URL environment variable is required');
    }

    RelayState = getIncomingUrlFromRequest(apiBaseUrl, req.path);
    if (!RelayState) {
      throw new Error('Could not determine RelayState from incoming URL');
    }
  } catch (error) {
    return res.boom.badImplementation(error.message);
  }

  const redirectUrl = new URL('saml/login', apiBaseUrl);
  redirectUrl.searchParams.append(
    'RelayState',
    RelayState
  );
  return res.redirect(redirectUrl.toString());
};

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
 * Handle refreshing tokens for SAML authentication
 *
 * @param {Object} request - an API Gateway request
 * @param {Object} response - an API Gateway response object
 * @param {number} [extensionSeconds] - number of seconds to extend token expiration (default: 43200)
 * @returns {Object} an API Gateway response
 */
async function refreshAccessToken(request, response, extensionSeconds = 12 * 60 * 60) {
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
    throw error;
  }

  // Use existing token values and just extend expiration time
  const newAccessToken = accessTokenRecord.accessToken;
  const username = accessTokenRecord.username;

  // Extend expiration time by the specified amount (default: 12 hours)
  // If expirationTime is undefined, use current time as base
  const baseTime = accessTokenRecord.expirationTime || Math.floor(Date.now() / 1000);
  const expirationTime = baseTime + extensionSeconds;

  // Update the existing record with new expiration time
  await accessTokenModel.update(
    { accessToken: accessTokenRecord.accessToken },
    {
      expirationTime,
    }
  );

  const jwtToken = createJwtToken({ accessToken: newAccessToken, username, expirationTime });
  return response.send({ token: jwtToken });
}

/**
 * Refreshes a SAML token
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function refreshEndpoint(req, res) {
  return await refreshAccessToken(req, res);
}

module.exports = {
  auth,
  login,
  refreshEndpoint,
  samlToken,
  // exported for testing
  getIncomingUrlFromRequest,
};
