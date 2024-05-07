'use strict';

const router = require('express-promise-router')();
const { StatsSearch } = require('@cumulus/db/dist/search/StatsSearch');

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
