//@ts-check

'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');
const { StatsSearch } = require('@cumulus/db');
const omit = require('lodash/omit');

/**
 * Map requested stats types to supported types
 *
 * @param {Object} req - express request object
 * @returns {string|undefined} returns the type of stats
 */
function getType(req) {
  const supportedTypes = {
    granules: 'granule',
    pdrs: 'pdr',
    collections: 'collection',
    logs: 'logs',
    providers: 'provider',
    executions: 'execution',
    reconciliationReports: 'reconciliationReport'
  };

  const typeRequested = get(req, 'params.type') || get(req, 'query.type');
  const type = get(supportedTypes, typeRequested);

  return type;
}

/**
 * get summary stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function summary(req, res) {
  const params = req.query;

  const now = Date.now();
  params.timestamp__from = Number.parseInt(get(
    params,
    'timestamp__from',
    now - 24 * 3600 * 1000
  ), 10);
  params.timestamp__to = Number.parseInt(get(params, 'timestamp__to', now), 10);
  const stats = new StatsSearch({ queryStringParameters: params }, 'granule');
  const r = await stats.summary();
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
  if (type) {
    const stats = new StatsSearch({ queryStringParameters: omit(req.query, 'type') }, type);
    const r = await stats.aggregate();
    return res.send(r);
  }
  return res.boom.badRequest('Type must be included in Stats Aggregate query string parameters');
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
