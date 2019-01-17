'use strict';

const router = require('express-promise-router')();
const collections = require('../endpoints/collections');
const granules = require('../endpoints/granules');
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

let token = require('../endpoints/token');
let { ensureAuthenticated } = require('./auth');
if (process.env.FAKE_AUTH === 'true') {
  token = require('./testAuth'); // eslint-disable-line global-require
  ensureAuthenticated = token.ensureAuthenticated;
}

// collections endpoints
router.use('/collections', ensureAuthenticated, collections);

// granules endpoints
router.use('/granules', ensureAuthenticated, granules);

// provider endpoints
router.use('/providers', ensureAuthenticated, providers);

// pdr endpoints
router.use('/pdrs', ensureAuthenticated, pdrs);

// rules endpoints
router.use('/rules', ensureAuthenticated, rules);

// executions endpoints
router.use('/executions/status', ensureAuthenticated, executionStatus);
router.use('/executions', ensureAuthenticated, executions);

// async operation endpoint
router.use('/async-operation', ensureAuthenticated, asyncOperations);

// bulk delete endpoint
router.use('/bulkDelete', ensureAuthenticated, bulkDelete);

// instance meta endpoint
router.use('/instanceMeta', ensureAuthenticated, instanceMeta);

// logs endpoint
router.use('/logs', ensureAuthenticated, logs);

// logs endpoint
router.use('/reconciliationReports', ensureAuthenticated, reconcilliationReports);

// schemas endpoint
router.use('/schemas', ensureAuthenticated, schemas);

// stats endpoint
router.use('/stats', ensureAuthenticated, stats);

// version endpoint
// this endpoint is not behind authentication
router.use('/version', version);

// workflows endpoint
router.use('/workflows', ensureAuthenticated, workflows);

router.delete('/token/:token', token.deleteTokenEndpoint);
router.delete('/tokenDelete/:token', token.deleteTokenEndpoint);
router.get('/token', token.tokenEndpoint);
router.post('/refresh', token.refreshEndpoint);


module.exports = router;
