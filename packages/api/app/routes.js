'use strict';

const router = require('express-promise-router')();
// const saml2 = require('saml2-js');
// const passport = require('passport');
// const passportSaml = require('passport-saml');
const saml = require('samlify');
const xmlChecker = require('xmlChecker');
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
const launchpadAuth = require('./launchpadAuth');

// Uncommen the following lines when working with a real endpoint, pulls metadata files from S3
// async function getMetadata () {
//   const bucket = process.env.system_bucket;
//   const stackName = process.env.stackName;
//   const launchpadMetadata = (await getS3Object(bucket, `${stackName}/crypto/launchpad-sbx-metadata.xml`)).Body;
//   const spMetadata = (await getS3Object(bucket, `${stackName}/crypto/aws-sp-metadata.xml`)).Body;
//   return [launchpadMetadata, spMetadata];
// }
// const metadata = getMetadata();

//samlify set up providers
const idp = saml.IdentityProvider({
  metadata: fs.readFileSync('/Users/savoie/projects/cumulus/launchpad/launchpad-sbx-metadata.xml')
  // metadata: metadata[0]
});
const sp = saml.ServiceProvider({
  metadata: fs.readFileSync('/Users/savoie/projects/cumulus/launchpad/sp-metadata.xml')
  // metadata: metadata[1]
});

saml.setSchemaValidator({
  validate: (response) => {
    console.log('validator', response);
    try {
      xmlChecker.check(response);
      return Promise.resolve('valid');
    }
    catch (error) {
      return ('XML Parser: ' + error.name + ' at ' + error.line + ',' + error.column + ': ' + error.message);
    }
  }
});

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
  // samlify stuff
  const { id, context } = sp.createLoginRequest(idp, 'redirect');
  console.log('about to redirect');
  console.log('context:', context);
  return res.redirect(context);
});

// Assert endpoint for when login completes
router.post("/saml/sso", (req, res) => {
  // samlify stuff
  console.log('got returned!');
  console.log(req.body);
  sp.parseLoginResponse(idp, 'post', req)
  .then(parseResult => {
    // Use the parseResult can do customized action
    console.log('parse results');
    console.log(parseResult);
    console.log('MY EXTRACT:', JSON.stringify(parseResult.extract, null, 2));
    const jwtToken = token.buildLaunchpadToken(parseResult);
    res.send(jwtToken);
  })
  .catch(console.error);

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
