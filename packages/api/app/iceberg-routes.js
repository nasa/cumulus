'use strict';

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');

const { defaultErrorHandler } = require('./middleware');
const stats = require('../endpoints/stats');
const version = require('../endpoints/version');

const log = new Logger('@cumulus/api/iceberg-routes');

let token = require('../endpoints/token');
let { ensureAuthorized } = require('./auth');
if (process.env.FAKE_AUTH === 'true') {
  log.warn('Disabling auth for test');
  token = require('./testAuth'); // eslint-disable-line global-require
  ensureAuthorized = token.ensureAuthorized;
}

// Import the limited routers for granules and executions
const granulesLimitedRouter = require('./iceberg-limited-granules');
const executionsLimitedRouter = require('./iceberg-limited-executions');

// Iceberg API only serves a subset of API endpoints:
// - version
// - list of granules (GET /granules)
// - list of executions (GET /executions)
// - stats endpoints
// - files (through granules files endpoint)

// granules list endpoint
router.use('/granules', ensureAuthorized, granulesLimitedRouter);

// executions list endpoint
router.use('/executions', ensureAuthorized, executionsLimitedRouter);

// stats endpoint (includes GET /stats and GET /stats/aggregate/:type?)
router.use('/stats', ensureAuthorized, stats);

// version endpoint
// this endpoint is not behind authentication
router.use('/version', version);

// Catch and send the error message down (instead of just 500: internal server error)
router.use(defaultErrorHandler);

module.exports = router;
