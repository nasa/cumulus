'use strict';

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');

const { defaultErrorHandler } = require('./middleware');

const collections = require('../endpoints/collections');
const granules = require('../endpoints/granules');
const providers = require('../endpoints/providers');
const pdrs = require('../endpoints/pdrs');
const rules = require('../endpoints/rules');
const executionStatus = require('../endpoints/execution-status');
const executions = require('../endpoints/executions');
const asyncOperations = require('../endpoints/async-operations');
const instanceMeta = require('../endpoints/instance-meta');
const logs = require('../endpoints/logs');
const orca = require('../endpoints/orca');
const reconcilliationReports = require('../endpoints/reconciliation-reports');
const replays = require('../endpoints/replays');
const schemas = require('../endpoints/schemas');
const stats = require('../endpoints/stats');
const version = require('../endpoints/version');
const workflows = require('../endpoints/workflows');
const dashboard = require('../endpoints/dashboard');
const elasticsearch = require('../endpoints/elasticsearch');
const deadLetterArchive = require('../endpoints/dead-letter-archive');
const { launchpadProtectedAuth } = require('./launchpadAuth');
const launchpadSaml = require('../endpoints/launchpadSaml');

const log = new Logger('@cumulus/api/routes');

let token = require('../endpoints/token');
let { ensureAuthorized } = require('./auth');
if (process.env.FAKE_AUTH === 'true') {
  log.warn('Disabling auth for test');
  token = require('./testAuth'); // eslint-disable-line global-require
  ensureAuthorized = token.ensureAuthorized;
}

// dead letters endpoint
router.use('/deadLetterArchive', ensureAuthorized, deadLetterArchive.router);

// collections endpoints
router.use('/collections', ensureAuthorized, collections.router);

// granules endpoints
router.use('/granules', ensureAuthorized, granules.router);

// provider endpoints
router.use('/providers', ensureAuthorized, providers.router);

// pdr endpoints
router.use('/pdrs', ensureAuthorized, pdrs.router);

// rules endpoints
router.use('/rules', ensureAuthorized, rules.router);

// executions endpoints
router.use('/executions/status', ensureAuthorized, executionStatus);
router.use('/executions', ensureAuthorized, executions.router);

// async operation endpoint
router.use('/asyncOperations', ensureAuthorized, asyncOperations.router);

// instance meta endpoint
router.use('/instanceMeta', ensureAuthorized, instanceMeta);

// logs endpoint
router.use('/logs', ensureAuthorized, logs);

// orca endpoint
router.use('/orca', ensureAuthorized, orca);

// reconciliationReports endpoint
router.use('/reconciliationReports', ensureAuthorized, reconcilliationReports.router);

// replays endpoint
router.use('/replays', ensureAuthorized, replays.router);

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
  log.info('Using SAML auth');
  // SAML SSO
  router.get('/saml/login', launchpadSaml.login);
  router.post('/saml/auth', launchpadSaml.auth);
  router.get('/token', launchpadSaml.samlToken);
  // disabled for now
  router.post('/refresh', launchpadSaml.refreshEndpoint);
} else {
  log.info('Using token authentication');
  router.get('/token', token.tokenEndpoint);
  router.post('/refresh', token.refreshEndpoint);
}
router.delete('/token/:token', token.deleteTokenEndpoint);
router.delete('/tokenDelete/:token', token.deleteTokenEndpoint);

router.use('/dashboard', dashboard);

router.use('/elasticsearch', ensureAuthorized, elasticsearch.router);

// Catch and send the error message down (instead of just 500: internal server error)
router.use(defaultErrorHandler);

module.exports = router;
