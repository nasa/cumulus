'use strict';

const saml2 = require('saml2-js');
const { AccessToken } = require('../models');
const { createJwtToken } = require('../lib/token');

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

const spOptions = {
  entity_id: 'https://u8ne7bgicd.execute-api.us-east-1.amazonaws.com:8004/dev/',
  assert_endpoint: 'https://u8ne7bgicd.execute-api.us-east-1.amazonaws.com:8004/dev/saml/auth',
  force_authn: false,
  nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  sign_get_request: false,
  allow_unencrypted_assertion: true
};
// Call service provider constructor with options
const launchpadCert =
  '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';
const sp = new saml2.ServiceProvider(spOptions);
const idpOptions = {
  sso_login_url:
    'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso', //process.env.IDP_LOGIN, // 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso'
  sso_logout_url: null, // should probably figure this out?? Does launchpad have this?
  certificates: [launchpadCert] // [fs.readFileSync(process.env.LAUNCHPAD_CERT).toString()]
};

const idp = new saml2.IdentityProvider(idpOptions);

// Starting point for SAML SSO login
const login = async (req, res) => {
  // saml2-js stuff
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
  sp.post_assert(idp, { request_body: req.body }, (err, samlResponse) => {
    if (err != null) {
      console.log('assert error');
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
