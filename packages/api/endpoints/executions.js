'use strict';

const router = require('express-promise-router')();

const { RecordDoesNotExist } = require('@cumulus/errors');
const {
  getKnexClient,
  ExecutionPgModel,
  translatePostgresExecutionToApiExecution,
} = require('@cumulus/db');
const { deleteExecution } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');

const Execution = require('../models/executions');

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
  const knex = await getKnexClient({ env: process.env });
  const executionPgModel = new ExecutionPgModel();
  let executionRecord;
  try {
    executionRecord = await executionPgModel.get(knex, { arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`Execution record with identifiers ${JSON.stringify(req.params)} does not exist.`);
    }
    throw error;
  }

  const translatedRecord = await translatePostgresExecutionToApiExecution(executionRecord, knex);
  return res.send(translatedRecord);
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
    executionModel = new Execution(),
    executionPgModel = new ExecutionPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
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

  let apiExecution;
  try {
    apiExecution = await executionModel.get({ arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('No record found');
    }
    throw error;
  }

  try {
    await knex.transaction(async (trx) => {
      await executionPgModel.delete(trx, { arn });
      await executionModel.delete({ arn });
      await deleteExecution({
        esClient,
        arn,
        index: process.env.ES_INDEX,
        ignore: [404],
      });
    });
  } catch (error) {
    // Delete is idempotent, so there may not be a DynamoDB
    // record to recreate
    if (apiExecution) {
      await executionModel.create(apiExecution);
    }
    throw error;
  }

  return res.send({ message: 'Record deleted' });
}

router.get('/:arn', get);
router.get('/', list);
router.delete('/:arn', del);

module.exports = {
  del,
  router,
};
