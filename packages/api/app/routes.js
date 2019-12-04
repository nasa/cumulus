'use strict';

const router = require('express-promise-router')();

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
const replays = require('../endpoints/replays');
const schemas = require('../endpoints/schemas');
const stats = require('../endpoints/stats');
const version = require('../endpoints/version');
const workflows = require('../endpoints/workflows');
const dashboard = require('../endpoints/dashboard');
const elasticsearch = require('../endpoints/elasticsearch');
const ems = require('../endpoints/ems');
const { launchpadProtectedAuth } = require('./launchpadAuth');
const launchpadSaml = require('../endpoints/launchpadSaml');

let token = require('../endpoints/token');
let { ensureAuthorized } = require('./auth');
if (process.env.FAKE_AUTH === 'true') {
  token = require('./testAuth'); // eslint-disable-line global-require
  ensureAuthorized = token.ensureAuthorized;
}

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

// replays endpoint
router.use('/replays', ensureAuthorized, replays);

// schemas endpoint
router.use('/schemas', ensureAuthorized, schemas);

// stats endpoint
router.use('/stats', ensureAuthorized, stats);

// version endpoint
// this endpoint is not behind authentication
router.use('/version', version);

// workflows endpoint
router.use('/workflows', ensureAuthorized, workflows);

// OAuth Token endpoints
if (launchpadProtectedAuth()) {
  // SAML SSO
  router.get('/saml/login', launchpadSaml.login);
  router.post('/saml/auth', launchpadSaml.auth);
  router.get('/token', launchpadSaml.samlToken);
  // disabled for now
  router.post('/refresh', launchpadSaml.refreshEndpoint);
} else {
  router.get('/token', token.tokenEndpoint);
  router.post('/refresh', token.refreshEndpoint);
}
router.delete('/token/:token', token.deleteTokenEndpoint);
router.delete('/tokenDelete/:token', token.deleteTokenEndpoint);

router.use('/dashboard', dashboard);

router.use('/elasticsearch', ensureAuthorized, elasticsearch);

router.use('/ems', ensureAuthorized, ems);

// Catch and send the error message down (instead of just 500: internal server error)
// Need all 4 params, because that's how express knows this is the error handler
// eslint-disable-next-line no-unused-vars
router.use((error, req, res, next) => {
  log.error(error);
  return res.boom.badRequest(error.message, error);
});

module.exports = router;
