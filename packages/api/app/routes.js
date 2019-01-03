'use strict'

const router = require('express-promise-router')();
const passport = require('passport')
const collection = require('../endpoints/collections');
const provider = require('../endpoints/providers');
const executionStatus = require('../endpoints/execution-status');
const executions = require('../endpoints/executions');
const asyncOperations = require('../endpoints/async-operations');
const bulkDelete = require('../endpoints/bulk-delete');
const { tokenEndpoint, refreshEndpoint } = require('../endpoints/token')
const { ensureAuthenticated } = require('./auth');

// collections endpoints
router.use('/collections', ensureAuthenticated, collection);

// provider endpoints
router.use('/providers', ensureAuthenticated, provider);

// executions endpoints
router.use('/executions/status', ensureAuthenticated, executionStatus);
router.use('/executions', ensureAuthenticated, executions);

// async operation endpoint
router.use('/async-operation', ensureAuthenticated, asyncOperations);

// bulk delete endpoint
router.use('/bulkDelete', ensureAuthenticated, bulkDelete);

// Login and Authentication
router.get('/login', passport.authenticate('oauth2'))
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