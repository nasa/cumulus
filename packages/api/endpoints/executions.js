'use strict';

const router = require('express-promise-router')();
const { RecordDoesNotExist } = require('@cumulus/errors');
const {
  getKnexClient,
  getGranuleExecutionCumulusIds,
  ExecutionPgModel,
} = require('@cumulus/db');
const Search = require('@cumulus/es-client/search').Search;
const models = require('../models');
const { getGranuleIdsForPayload } = require('../lib/granules');
const { validateBulkGranulesRequest } = require('../lib/request');

/**
 * List and search executions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'execution',
    process.env.ES_INDEX
  );
  const response = await search.query();
  return res.send(response);
}

/**
 * get a single execution
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const arn = req.params.arn;

  const e = new models.Execution();

  try {
    const response = await e.get({ arn });
    return res.send(response);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${arn}`);
    }
    throw error;
  }
}

/**
 * Delete an execution
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    executionModel = new models.Execution(),
    executionPgModel = new ExecutionPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const { arn } = req.params;

  try {
    await executionModel.get({ arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('No record found');
    }
    throw error;
  }

  await knex.transaction(async (trx) => {
    await executionPgModel.delete(trx, { arn });
    await executionModel.delete({ arn });
  });

  return res.send({ message: 'Record deleted' });
}

/**
 * Get execution history for a single granule or multiple granules
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function searchByGranules(req, res) {
  const payload = req.body;
  const granuleIds = await getGranuleIdsForPayload(payload);
  const knex = await getKnexClient();
  const executionPgModel = new ExecutionPgModel();

  const executionCumulusIds = await getGranuleExecutionCumulusIds(knex, ['granule_id'], granuleIds);

  const executions = await executionPgModel
    .searchByCumulusIds(knex, executionCumulusIds);

  return res.send(executions);
}

router.post('/search-by-granules', validateBulkGranulesRequest, searchByGranules);
router.get('/:arn', get);
router.get('/', list);
router.delete('/:arn', del);

module.exports = router;
