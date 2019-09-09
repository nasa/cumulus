'use strict';

const router = require('express-promise-router')();
const saml2 = require('saml2-js');

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
const launchpadAuth = require('./launchpadAuth');

// set up SP and IdP
const sp_options = {
  entity_id: process.env.ENTITY_ID,
  private_key: fs.readFileSync(process.env.PRIV_KEY).toString(),
  certificate: fs.readFileSync(process.env.CERT).toString(),
  assert_endpoint: process.env.ASSERT_ENDPOINT, // change to just /assert
  force_authn: true,
  // auth_context: { comparison: "exact", class_refs: ["urn:oasis:names:tc:SAML:1.0:am:password"] },
  // nameid_format: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
  sign_get_request: false,
  allow_unencrypted_assertion: true
}

// Call service provider constructor with options
const sp = new saml2.ServiceProvider(sp_options);

// Example use of service provider.
// Call metadata to get XML metatadata used in configuration.
const metadata = sp.create_metadata();

const idp_options = {
  sso_login_url: process.env.IDP_LOGIN, // 'https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso'
  sso_logout_url: null, // should probably figure this out?? Does launchpad have this?
  certificates: [fs.readFileSync(process.env.LAUNCHPAD_CERT).toString()]
};
const idp = new saml2.IdentityProvider(idp_options);

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
router.get("/samlLogin", function(req, res) {
  sp.create_login_request_url(idp, {}, function(err, login_url, request_id) {
    if (err != null)
      return res.send(500);
    res.redirect(login_url);
  });
});

// Assert endpoint for when login completes
router.post("/saml/sso", function(req, res) { // /assert
  const state = get(event, 'query.state');
  const options = {request_body: req.body};
  sp.post_assert(idp, options, function(err, saml_response) {
    if (err != null)
      return res.send(500);

    // use the SAML response to build a jwtToken to return to dashboard
    const jwtToken = token.buildLaunchpadToken(saml_response);

    if (state) {
      return res
        .status(307)
        .set({ Location: `${decodeURIComponent(state)}?token=${jwtToken}` })
        .send('Redirecting');
    }
    const username = saml_response.user.name_id;
    res.send('Hello', username);
  });
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
