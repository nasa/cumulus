'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');
const Logger = require('@cumulus/logger');
const { StatsIcebergSearch } = require('@cumulus/db/duckdb');
const omit = require('lodash/omit');
const { getType } = require('../lib/statsHelpers');

const log = new Logger({ sender: '@cumulus/api/iceberg-stats' });

/**
 * get summary stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function summary(req, res) {
  try {
    const params = req.query;

    const now = Date.now();
    params.timestamp__from = Number.parseInt(get(
      params,
      'timestamp__from',
      now - 24 * 3600 * 1000
    ), 10);
    params.timestamp__to = Number.parseInt(get(params, 'timestamp__to', now), 10);
    const stats = new StatsIcebergSearch({ queryStringParameters: params }, 'granule');
    const r = await stats.summary();
    return res.send(r);
  } catch (error) {
    log.error('StatsIcebergSearch Summary Query Failed', error);
    if (res.boom) {
      return res.boom.badImplementation('Error querying S3/Iceberg data');
    }
    return res.status(500).send({
      error: 'Internal Server Error',
      message: 'Error querying S3/Iceberg data',
    });
  }
}

/**
 * get aggregate stats
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function aggregate(req, res) {
  try {
    const type = getType(req);
    if (type) {
      const stats = new StatsIcebergSearch(
        { queryStringParameters: omit(req.query, 'type') },
        type
      );
      const r = await stats.aggregate();
      return res.send(r);
    }
    return res.boom.badRequest(
      'Type must be included in the Stats Aggregate path parameter or query string parameters'
    );
  } catch (error) {
    log.error('StatsIcebergSearch Aggregate Query Failed', error);
    if (res.boom) {
      return res.boom.badImplementation('Error querying S3/Iceberg data');
    }
    return res.status(500).send({
      error: 'Internal Server Error',
      message: 'Error querying S3/Iceberg data',
    });
  }
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
