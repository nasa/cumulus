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

const launchpadPublicCertificate = async (launchpadPublicMetadataPath) => {
  const parsed = aws.parseS3Uri(launchpadPublicMetadataPath);
  const launchpadMetatdataXML = (await aws.getS3Object(parsed.Bucket, parsed.Key)).Body.toString();
  const metadata = await parseXmlString(launchpadMetatdataXML);
  const certificate = JSONPath('$..ds:X509Certificate', metadata);
  if (certificate) return flatten(certificate);
  return [];
};

const buildLaunchpadJwtToken = async (samlResponse) => {
  const {
    user: { name_id: username, session_index: accessToken }
  } = samlResponse;

  const accessTokenModel = new AccessToken();
  await accessTokenModel.create({ accessToken });
  // TODO [MHS, 2019-09-20]  how long?  Is there a way to see authentication duration with samlsso?
  const expirationTime = Date.now() + 60 * 60 * 1000;
  return createJwtToken({ accessToken, expirationTime, username });
};

const prepareSamlProviders = async () => {
  const LaunchpadX509Certificate = await launchpadPublicCertificate('s3://mhs4-internal/mhs4/launchpad/launchpad-sbx-metadata.xml');

  const spOptions = {
    entity_id: 'https://u8ne7bgicd.execute-api.us-east-1.amazonaws.com:8004/dev/',
    assert_endpoint: 'https://u8ne7bgicd.execute-api.us-east-1.amazonaws.com:8004/dev/saml/auth',
    force_authn: false,
    nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    sign_get_request: false,
    allow_unencrypted_assertion: true
  };

  const idpOptions = {
    sso_login_url: 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso', //process.env.IDP_LOGIN, // 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso'
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
      console.log(`login_url: ${loginUrl}`);
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
      console.log('SAML post assert error');
      console.log(err);
      return res.send(500); // TODO [MHS, 2019-09-19]  BOOM it
    }
    console.log('samlResponse', JSON.stringify(samlResponse, null, 2));

    buildLaunchpadJwtToken(samlResponse)
      .then((LaunchpadJwtToken) => {
        const Location = `${req.body.RelayState}/?token=${LaunchpadJwtToken}`;
        console.log(`redirect to ${Location}`);
        return res.redirect(Location);
      });
  });
};

module.exports = {
  login,
  auth
};
