'use strict'

const router = require('express-promise-router')();
const collections = require('../endpoints/collections');
const granules = require('../endpoints/granules');
const providers = require('../endpoints/providers');
const pdrs = require('../endpoints/pdrs');
const executionStatus = require('../endpoints/execution-status');
const executions = require('../endpoints/executions');
const asyncOperations = require('../endpoints/async-operations');
const instanceMeta = require('../endpoints/instance-meta');
const bulkDelete = require('../endpoints/bulk-delete');
const logs = require('../endpoints/logs');
const { tokenEndpoint, refreshEndpoint } = require('../endpoints/token')
const { ensureAuthenticated } = require('./auth');

// collections endpoints
router.use('/collections', ensureAuthenticated, collections);

// granules endpoints
router.use('/granules', ensureAuthenticated, granules);

// provider endpoints
router.use('/providers', ensureAuthenticated, providers);

// pdr endpoints
router.use('/pdrs', ensureAuthenticated, pdrs);

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

// OAuth Implementation
router.get('/token/callback',
  (req, res) => {
    // Successful authentication, redirect home.
    return res.send({ params: req.params, query: req.query });
  });
router.get('/token', tokenEndpoint)
router.post('/refresh', refreshEndpoint)

router.get('/404', (req, res) => {
  return res.send('access denied');
})

module.exports = router;