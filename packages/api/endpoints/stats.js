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
// eslint-disable-next-line no-unused-vars
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
  const stats = new StatsSearch(req.query);
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
  const stats = new StatsSearch(req.query);
  const r = await stats.aggregate_search();
  return res.send(r);
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
