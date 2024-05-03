'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');
const Stats = require('@cumulus/es-client/stats');
const { StatsSearch } = require('@cumulus/db/dist/search/StatsSearch');

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

  params.timestamp__from = Number.parseInt(get(
    params,
    'timestamp__from',
    0
  ), 10);
  params.timestamp__to = Number.parseInt(get(params, 'timestamp__to', Date.now()), 10);

  const stats = new Stats({ queryStringParameters: params }, undefined, process.env.ES_INDEX);
  const r = await stats.query();
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
  if (req.url.includes('limit') || req.url.includes('sort_key') || req.url.includes('page')) {
    const type = getType(req);
    const stats = new Stats({
      queryStringParameters: req.query,
    }, type, process.env.ES_INDEX);

    const r = await stats.count();
    return res.send(r);
  }
  const statsSearcher = new StatsSearch(req.query).aggregate_search();
  return res.send(statsSearcher);
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
