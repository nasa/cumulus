'use strict';

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');

const { defaultErrorHandler } = require('./middleware');
const stats = require('../endpoints/iceberg-stats');
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
const granulesIcebergRouter = require('../endpoints/iceberg-granules');
const executionsIcebergRouter = require('../endpoints/iceberg-executions');
const collectionsIcebergRouter = require('../endpoints/iceberg-collections');
const providersIcebergRouter = require('../endpoints/iceberg-providers');
const pdrsIcebergRouter = require('../endpoints/iceberg-pdrs');
const rulesIcebergRouter = require('../endpoints/iceberg-rules');
const asyncOperationsIcebergRouter = require('../endpoints/iceberg-async-operations');
const reconciliationReportsIcebergRouter = require('../endpoints/iceberg-reconciliation-reports');

// Iceberg API only serves a subset of API endpoints:
// - version
// - list of collections (GET /collections)
// - list of granules (GET /granules)
// - list of providers (GET /providers)
// - list of pdrs (GET /pdrs)
// - list of rules (GET /rules)
// - list of executions (GET /executions)
// - list of async-operations (GET /async-operations)
// - list of reconciliation-reports (GET /reconciliation-reports)
// - stats endpoints

// granules list endpoint
router.use('/granules', ensureAuthorized, granulesIcebergRouter);

// executions list endpoint
router.use('/executions', ensureAuthorized, executionsIcebergRouter);

// collections list endpoint
router.use('/collections', ensureAuthorized, collectionsIcebergRouter);

// providers list endpoint
router.use('/providers', ensureAuthorized, providersIcebergRouter);

// pdrs list endpoint
router.use('/pdrs', ensureAuthorized, pdrsIcebergRouter);

// rules list endpoint
router.use('/rules', ensureAuthorized, rulesIcebergRouter);

// async-operations list endpoint
router.use('/async-operations', ensureAuthorized, asyncOperationsIcebergRouter);

// reconciliation-reports list endpoint
router.use('/reconciliation-reports', ensureAuthorized, reconciliationReportsIcebergRouter);

// stats endpoint (includes GET /stats and GET /stats/aggregate/:type?)
router.use('/stats', ensureAuthorized, stats);

// version endpoint
// this endpoint is not behind authentication
router.use('/version', version);

// Catch and send the error message down (instead of just 500: internal server error)
router.use(defaultErrorHandler);

module.exports = router;
