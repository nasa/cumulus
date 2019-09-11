'use strict';

const router = require('express-promise-router')();
// const saml2 = require('saml2-js');
// const passport = require('passport');
// const passportSaml = require('passport-saml');
// const SamlStrategy = require('passport-saml').Strategy;
const saml = require('samlify');
const fs = require('fs');
const {
  aws: {
    getS3Object
  }
} = require('@cumulus/common');
const log = require('@cumulus/common/log');

const collections = require('../endpoints/collections');
const granules = require('../endpoints/granules');
const granuleCsv = require('../endpoints/granule-csv');
const providers = require('../endpoints/providers');
const pdrs = require('../endpoints/pdrs');
const rules = require('../endpoints/rules');
const executionStatus = require('../endpoints/execution-status');
const executions = require('../endpoints/executions');
const asyncOperations = require('../endpoints/async-operations');
const instanceMeta = require('../endpoints/instance-meta');
const bulkDelete = require('../endpoints/bulk-delete');
const logs = require('../endpoints/logs');
const reconcilliationReports = require('../endpoints/reconciliation-reports');
const schemas = require('../endpoints/schemas');
const stats = require('../endpoints/stats');
const version = require('../endpoints/version');
const workflows = require('../endpoints/workflows');
const dashboard = require('../endpoints/dashboard');
const elasticsearch = require('../endpoints/elasticsearch');
const ems = require('../endpoints/ems');
// const { ServiceProvider, IdentityProvider } = require('../node_modules/saml2-js');
// ../node_modules/saml2-js/lib-js/saml2')
const launchpadAuth = require('./launchpadAuth');

// // set up SP and IdP
// const sp_options = {
//   entity_id: 'https://cumulus-sandbox.earthdata.nasa.gov/jl-test-integration', //'https://cumulus-sandbox.earthdata.nasa.gov/kk-test-integration', //process.env.ENTITY_ID,
//   // private_key: fs.readFileSync('/Users/kakelly2/Documents/Projects/serverkey.pem').toString(),// fs.readFileSync(process.env.PRIV_KEY).toString(),
//   // certificate: fs.readFileSync('/Users/kakelly2/Documents/Projects/crt-file.crt').toString(),// fs.readFileSync(process.env.CERT).toString(),
//   assert_endpoint: 'https://5hlnofihz8.execute-api.us-east-1.amazonaws.com:8000/dev/saml/auth', // 'https://cumulus-sandbox.earthdata.nasa.gov/saml/sso', //process.env.ASSERT_ENDPOINT, // change to just /assert
//   force_authn: false,
//   // auth_context: { comparison: "exact", class_refs: ["urn:oasis:names:tc:SAML:1.0:am:password"] },
//   // nameid_format: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
//   sign_get_request: false,
//   allow_unencrypted_assertion: true
// }

// // Call service provider constructor with options
// const sp = new saml2.ServiceProvider(sp_options);

// Example use of service provider.
// Call metadata to get XML metatadata used in configuration.
// const metadata = sp.create_metadata();
// async function getMetadata () {
//   const bucket = process.env.system_bucket;
//   const stackName = process.env.stackName;
//   const launchpadMetadata = (await getS3Object(bucket, `${stackName}/crypto/launchpad-sbx-metadata.xml`)).Body;
//   const spMetadata = (await getS3Object(bucket, `${stackName}/crypto/aws-sp-metadata.xml`)).Body;
//   return [launchpadMetadata, spMetadata];
// }

// const metadata = getMetadata();
// const idp_options = {
//   sso_login_url: 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso',//process.env.IDP_LOGIN, // 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso'
//   sso_logout_url: null, // should probably figure this out?? Does launchpad have this?
//   certificates: [launchpadCert]// [fs.readFileSync(process.env.LAUNCHPAD_CERT).toString()]
//   // certificates: [fs.readFileSync('/Users/kakelly2/Documents/Projects/launchpad-sbx.pem').toString()]// [fs.readFileSync(process.env.LAUNCHPAD_CERT).toString()]
// // {bucket}/{prefix}/crypto/launchpad-saml.pem
// };
// const idp = new saml2.IdentityProvider(idp_options);

// router.use(passport.initialize());

// passport.use(new passportSaml.Strategy(
//   {
//     path: 'https://cumulus-sandbox.earthdata.nasa.gov/saml/sso', //'https://5hlnofihz8.execute-api.us-east-1.amazonaws.com:8000/dev/saml/auth', // assert? 
//     callbackUrl: 'https://cumulus-sandbox.earthdata.nasa.gov/saml/sso',
//     entryPoint: 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso', //'https://auth.launchpad-sbx.nasa.gov', // IDP url
//     issuer: 'https://cumulus-sandbox.earthdata.nasa.gov/', // entity ID
//     cert: fs.readFileSync('/Users/kakelly2/Documents/Projects/launchpad-sbx.pem').toString(), // IDP public key
//     identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified'
//     // authnContext: 'urn:oasis:names:tc:SAML:2.0:ac:classes:TimeSyncToken'
//   },
//   (profile, done) => { // Verify fxn
//     console.log('Profile : ', profile);
//     const state = get(profile, 'query.state');
//     const username = profile.nameID;
//     const jwtToken = token.buildLaunchpadToken({user: { name_id: username, session_index: '9887654'}});
//     return done
//       .status(307)
//       .set({ Location: `${decodeURIComponent(state)}?token=${jwtToken}` })
//       .send('Redirecting');
//   }
// ));

const idp = saml.IdentityProvider({
  metadata: fs.readFileSync('/Users/kakelly2/Documents/Projects/launchpad-sbx-metadata.xml')
  // metadata: metadata[0]
});
const sp = saml.ServiceProvider({
  metadata: fs.readFileSync('/Users/kakelly2/Documents/Projects/sp-metadata.xml')
  // metadata: metadata[1]
});

const request_id = '12345'; // Random string?

let token = require('../endpoints/token');
let { ensureAuthorized } = require('./auth');
if (process.env.FAKE_AUTH === 'true') {
  token = require('./testAuth'); // eslint-disable-line global-require
  ensureAuthorized = token.ensureAuthorized;
}

if (process.env.OAUTH_PROVIDER === 'launchpad') {
  ensureAuthorized = launchpadAuth.ensureAuthorized;
}

// Starting point for login
router.get("/samlLogin", (req, res) => {
  const { id, context } = sp.createLoginRequest(idp, 'redirect');
  console.log('about to redirect');
  console.log(context);
  return res.redirect(context);
  // passport.authenticate('saml',  (err, profile) => {
  //   console.log('in login');
  //   console.log('Profile: ', profile);
  // }),
  // // { successRedirect: '/', failureRedirect: '/' })
  // function(req, res) {
  //   res.redirect('/');
  // }
  // // sp.create_login_request_url(idp, {}, function(err, login_url, request_id) {
  //   if (err != null)
  //     return res.send(500);
  //   res.redirect(login_url);
  // });
});

// Assert endpoint for when login completes
router.post("/saml/sso", (req, res) => {
  console.log('got returned!');
  console.log(req);
  sp.parseLoginResponse(idp, 'post', req)
  .then(parseResult => {
    // Use the parseResult can do customized action
    console.log(parseResult);
    res.send('Hello');
  })
  .catch(console.error);
  // passport.authenticate('saml', { failureRedirect: '/', failureFlash: true }, (err, resp) => {
  //   if (err != null) console.log('merp', err);
  //   console.log('in the post');
  //   console.log(resp);
  // });
  // res.status(307)
  //   .set({Location: 'somethin83995'})
  //   .send('Redirecting');
// function(req, res) { // /assert
  // const state = get(event, 'query.state');
  // const options = {request_body: req.body};
  // sp.post_assert(idp, options, function(err, saml_response) {
  //   if (err != null) {
  //     console.log('assert error');
  //     return res.send(500);
  //   }
  //   console.log(saml_response);
  //   // use the SAML response to build a jwtToken to return to dashboard
  //   const jwtToken = token.buildLaunchpadToken(saml_response);

  //   if (state) {
      // return res
      //   .status(307)
      //   .set({ Location: `${decodeURIComponent(state)}?token=${jwtToken}` })
      //   .send('Redirecting');
  //   }
  //   const username = saml_response.user.name_id;
  //   res.send('Hello', username);
  // });
// }
});

// collections endpoints
router.use('/collections', ensureAuthorized, collections);

// granules endpoints
router.use('/granules', ensureAuthorized, granules);

// granule csv endpoints
router.use('/granule-csv', ensureAuthorized, granuleCsv);

// provider endpoints
router.use('/providers', ensureAuthorized, providers);

// pdr endpoints
router.use('/pdrs', ensureAuthorized, pdrs);

// rules endpoints
router.use('/rules', ensureAuthorized, rules);

// executions endpoints
router.use('/executions/status', ensureAuthorized, executionStatus);
router.use('/executions', ensureAuthorized, executions);

// async operation endpoint
router.use('/asyncOperations', ensureAuthorized, asyncOperations);

// bulk delete endpoint
router.use('/bulkDelete', ensureAuthorized, bulkDelete);

// instance meta endpoint
router.use('/instanceMeta', ensureAuthorized, instanceMeta);

// logs endpoint
router.use('/logs', ensureAuthorized, logs);

// logs endpoint
router.use('/reconciliationReports', ensureAuthorized, reconcilliationReports);

// schemas endpoint
router.use('/schemas', ensureAuthorized, schemas);

// stats endpoint
router.use('/stats', ensureAuthorized, stats);

// version endpoint
// this endpoint is not behind authentication
router.use('/version', version);

// workflows endpoint
router.use('/workflows', ensureAuthorized, workflows);

router.delete('/token/:token', token.deleteTokenEndpoint);
router.delete('/tokenDelete/:token', token.deleteTokenEndpoint);
router.get('/token', token.tokenEndpoint);
router.post('/refresh', token.refreshEndpoint);

router.use('/dashboard', dashboard);

router.use('/elasticsearch', ensureAuthorized, elasticsearch);

router.use('/ems', ensureAuthorized, ems);

// Catch and send the error message down (instead of just 500: internal server error)
// Need all 4 params, because that's how express knows this is the error handler
// eslint-disable-next-line no-unused-vars
router.use((error, req, res, next) => {
  log.error(error);
  return res.status(500).send({ error: error.message });
});

module.exports = router;
