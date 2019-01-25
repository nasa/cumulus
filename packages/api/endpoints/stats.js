'use strict';

const router = require('express-promise-router')();
const get = require('lodash.get');
const moment = require('moment');
const Stats = require('../es/stats');

/**
 * filter approved types
 *
 * @param {Object} req - express request object
 * @returns {Object} returns the type and index as an object
 */
function getType(req) {
  let index;

  const supportedTypes = {
    granules: 'granule',
    pdrs: 'pdr',
    collections: 'collection',
    logs: 'logs',
    providers: 'provider',
    executions: 'execution'
  };

  const typeRequested = get(req, 'params.type', null);
  const type = get(supportedTypes, typeRequested);

  return { type, index };
}


/**
 * get summary stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function summary(req, res) {
  const params = req.params;
  params.timestamp__from = get(
    params,
    'timestamp__from',
    moment().subtract(1, 'day').unix()
  );
  params.timestamp__to = get(params, 'timestamp__to', Date.now());

  const stats = new Stats({ queryStringParameters: params });
  const r = await stats.query();
  return res.send(r);
}

/**
 * get histogram stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function histogram(req, res) {
  const type = getType(req);

  const stats = new Stats({
    queryStringParameters: req.query
  }, type.type, type.index);
  const r = await stats.histogram();
  return res.send(r);
}

/**
 * get aggregate stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function aggregate(req, res) {
  const type = getType(req);

  const stats = new Stats({
    queryStringParameters: req.query
  }, type.type, type.index);
  const r = await stats.count();
  return res.send(r);
}

/**
 * get average stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function average(req, res) {
  const type = getType(req);

  const stats = new Stats({
    queryStringParameters: req.query
  }, type.type, type.index);
  const r = await stats.avg();
  return res.send(r);
}

router.get('/histogram/:type?', histogram);
router.get('/aggregate/:type?', aggregate);
router.get('/average/:type?', average);
router.get('/', summary);

module.exports = router;
