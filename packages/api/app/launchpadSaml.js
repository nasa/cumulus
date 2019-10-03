'use strict';

const saml2 = require('saml2-js');
const { JSONPath } = require('jsonpath-plus');
const { parseString } = require('xml2js');
const { promisify } = require('util');
const flatten = require('lodash.flatten');

const aws = require('@cumulus/common/aws');

const { AccessToken } = require('../models');
const { createJwtToken } = require('../lib/token');

const parseXmlString = promisify(parseString);

/**
 * reads public metadata file from S3 path and returns the X509Certificate value
 *
 * The XML file is a copy of the launchpad's idp metadata found here for the sandbox
 * https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml
 *
 * @param {string} launchpadPublicMetadataPath
 * @returns {Promise<Array>} Array containing the X509Certificate from the input metadata file.
 */
const launchpadPublicCertificate = async (launchpadPublicMetadataPath) => {
  let launchpadMetatdataXML;
  const parsed = aws.parseS3Uri(launchpadPublicMetadataPath);
  try {
    launchpadMetatdataXML = (await aws.getS3Object(parsed.Bucket, parsed.Key)).Body.toString();
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NoSuchBucket') {
      error.message = `Cumulus could not find Launchpad public xml metadata at ${launchpadPublicMetadataPath}`;
    }
    throw error;
  }
  const metadata = await parseXmlString(launchpadMetatdataXML);
  const certificate = JSONPath({wrap: false},'$..ds:X509Certificate', metadata);
  if (certificate) return flatten(certificate);
  throw new Error(`Failed to retrieve Launchpad metadata X509 Certificate from ${launchpadPublicMetadataPath}`);
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
  const {
    user: { name_id: username, session_index: accessToken }
  } = samlResponse;

  const expirationTime = Date.now() + 60 * 60 * 1000;
  const accessTokenModel = new AccessToken();
  await accessTokenModel.create({ accessToken, expirationTime, username });
  return createJwtToken({ accessToken, expirationTime, username });
};

/**
* convenience function to set up SAML Identity and Service Providers
*/
const prepareSamlProviders = async () => {
  const LaunchpadX509Certificate = await launchpadPublicCertificate(
    process.env.LAUNCHPAD_METADATA_PATH
  );

  const spOptions = {
    entity_id: process.env.ENTITY_ID,
    assert_endpoint: process.env.ASSERT_ENDPOINT,
    force_authn: false,
    nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    sign_get_request: false,
    allow_unencrypted_assertion: true
  };

  const idpOptions = {
    sso_login_url: process.env.IDP_LOGIN,
    sso_logout_url: null,
    certificates: LaunchpadX509Certificate
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
      if (err != null) return res.boom.badRequest('Could not create login request url.', err);
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
 * @returns {Object} response redirect back to the initiating requests relay state with a valid token query parameter.
 */
const auth = async (req, res) => {
  const { idp, sp } = await prepareSamlProviders();
  sp.post_assert(idp, { request_body: req.body }, (err, samlResponse) => {
    if (err != null) {
      return res.boom.badRequest('SAML post assert error', err);
    }
    return buildLaunchpadJwt(samlResponse)
      .then((LaunchpadJwtToken) => {
        const Location = `${req.body.RelayState}/?token=${LaunchpadJwtToken}`;
        return res.redirect(Location);
      })
      .catch((error) => res.boom.badRequest('Could not build JWT from SAML response', error));
  });
};

const notImplemented = async (req, res) => res.boom.notImplemented(
  `endpoint: "${req.path}" not implemented. Login with launchpad.`
);

const tokenEndpoint = notImplemented;
const refreshEndpoint = notImplemented;

module.exports = {
  auth,
  login,
  refreshEndpoint,
  tokenEndpoint
};
