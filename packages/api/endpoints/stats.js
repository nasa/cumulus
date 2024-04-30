'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');
const Stats = require('@cumulus/es-client/stats');

const {
  getKnexClient,
  localStackConnectionEnv,
} = require('@cumulus/db');

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
 * get aggregate stats using postgresql
 *
 * @param {Object} req - express request object
 * @param {Object} knex - knex object
 * @returns {any} the promise of express response object
 */
async function aggregateStats(req, knex) {
  //let queryCode = get(req, 'query.code'); // api status code (request)
  //let queryState = get(req, 'query.state');
  const queryType = req.match(/[&?]type=([^&]+)/) ? req.match(/[&?]type=([^&]+)/)[1] : 'granules'; // what table to query
  const queryFrom = req.match(/[&?]timestamp__to=([^&]+)/) ?
    req.match(/[&?]timestamp__to=([^&]+)/)[1] : undefined; //range lower bound
  const queryTo = req.match(/[&?]timestamp__from=([^&]+)/) ?
    req.match(/[&?]timestamp__from=([^&]+)/)[1] : undefined; //range upper bound
  const queryCollectionId = get(req, 'query.collectionId'); //collectionId if exists
  const queryProvider = get(req, 'query.provider'); //provider if exists
  const queryField = req.match(/[&?]field=([^&]+)/) ? req.match(/[&?]field=([^&]+)/)[1] : 'status';
  // let queryStatus= get(req, 'query.status'); //what to distinct count by
  let r;
  // need to figure out the KNEX conversion for the nested error type queries
  // query builder
  let aggregateQuery;
  if (queryType) {
    aggregateQuery = knex(`${queryType}`).select(`${queryField}`).count('* as count').groupBy(`${queryField}`)
      .orderBy('count', 'desc');
    if (queryCollectionId) {
      aggregateQuery = aggregateQuery.where('collection_cumulus_id', '=', queryCollectionId);
    }
    if (queryTo) {
      aggregateQuery = aggregateQuery.where('ending_date_time', '>=', new Date(Number.parseInt(queryTo, 10)));
    }
    if (queryFrom) {
      aggregateQuery = aggregateQuery.where('beginning_date_time', '<=', new Date(Number.parseInt(queryFrom, 10)));
    }
    if (queryProvider) {
      aggregateQuery = aggregateQuery.where('provider_cumulus_id', '=', queryProvider);
    }
    const result = await knex.raw(aggregateQuery.toString());
    r = result.rows;
  }
  /***getting query results*/
  return r;
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
  let r;
  if (!process.env.ES_INDEX) {
    const stats = new Stats({
      queryStringParameters: req.query,
    }, type, process.env.ES_INDEX);
    r = await stats.count();
  } else {
    const knex = await getKnexClient({ env: { ...localStackConnectionEnv, ...process.env } });
    r = await (aggregateStats(req, knex));
  }
  res.send(r);
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
