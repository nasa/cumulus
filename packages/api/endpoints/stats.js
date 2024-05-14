'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');
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
  const queryObj = {
    queryStringParameters: req.query,
  };

  const stats = new StatsSearch(queryObj, 'summary');
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
  const queryObj = {
    queryStringParameters: req.query,
  };

  if (getType(req)) {
    const stats = new StatsSearch(queryObj, 'aggregate');
    const r = await stats.query();
    return res.send(r);
  }
  throw new Error('No type defined in AggregateQueryRequest');
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
