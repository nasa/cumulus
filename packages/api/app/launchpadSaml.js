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
  const parsed = aws.parseS3Uri(launchpadPublicMetadataPath);
  const launchpadMetatdataXML = (await aws.getS3Object(parsed.Bucket, parsed.Key)).Body.toString();
  const metadata = await parseXmlString(launchpadMetatdataXML);
  const certificate = JSONPath('$..ds:X509Certificate', metadata);
  if (certificate) return flatten(certificate);
  return [];
};

/**
 * Store the SAML response's token in the AccessResponse table and return a JWT
 * from the derived values.
 *
 * @param {Object} samlResponse - post_assert response from saml IDP provider
 *
 * @returns {Promise<Object>} - a valid JWT token that can be used for authentication.
 */
const buildLaunchpadJwtToken = async (samlResponse) => {
  const {
    user: { name_id: username, session_index: accessToken }
  } = samlResponse;

  // TODO [MHS, 2019-09-20]  how long?  Is there a way to see authentication duration with samlsso?
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
    sso_logout_url: null, // should probably figure this out?? Does launchpad have this?
    certificates: LaunchpadX509Certificate
  };

  const idp = new saml2.IdentityProvider(idpOptions);
  const sp = new saml2.ServiceProvider(spOptions);

  return { idp, sp };
};

// Starting point for SAML SSO login
const login = async (req, res) => {
  // saml2-js stuff
  const { idp, sp } = await prepareSamlProviders();
  const relayState = req.query.RelayState;
  sp.create_login_request_url(
    idp,
    { relay_state: relayState },
    (err, loginUrl) => {
      if (err != null) return res.send(500); // TODO [MHS, 2019-09-19] should use BOOM
      return res.redirect(loginUrl);
    }
  );
};

// SAML AssertionConsumerService (ACS) endpoint.
const auth = async (req, res) => {
  const { idp, sp } = await prepareSamlProviders();
  sp.post_assert(idp, { request_body: req.body }, (err, samlResponse) => {
    if (err != null) {
      return res.boom.badRequest('SAML post assert error', err);
    }
    return buildLaunchpadJwtToken(samlResponse)
      .then((LaunchpadJwtToken) => {
        const Location = `${req.body.RelayState}/?token=${LaunchpadJwtToken}`;
        return res.redirect(Location);
      })
      .catch((error) => res.boom.badRequest('Could not build JWToken from SAML response', error));
  });
};

module.exports = {
  login,
  auth
};
