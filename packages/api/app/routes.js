'use strict'

const router = require('express-promise-router')();
const passport = require('passport')
const collectionRouter = require('../endpoints/collections');
const providerRouter = require('../endpoints/providers');
const executionStatusRouter = require('../endpoints/execution-status');
const { tokenEndpoint, refreshEndpoint } = require('../endpoints/token')
const { ensureAuthenticated } = require('./auth');

// collections endpoints
router.use('/collections', ensureAuthenticated, collectionRouter);

// provider endpoints
router.use('/providers', ensureAuthenticated, providerRouter);

// executions endpoints
router.use('/executions/status', ensureAuthenticated, executionStatusRouter);

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