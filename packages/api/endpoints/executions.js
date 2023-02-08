'use strict';

const router = require('express-promise-router')();

const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const {
  getKnexClient,
  getApiGranuleExecutionCumulusIds,
  getApiGranuleCumulusIds,
  getWorkflowNameIntersectFromGranuleIds,
  ExecutionPgModel,
  translatePostgresExecutionToApiExecution,
  createRejectableTransaction,
} = require('@cumulus/db');
const { deleteExecution } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');

const Execution = require('../models/executions');
const { isBadRequestError } = require('../lib/errors');
const { getGranulesForPayload } = require('../lib/granules');
const { writeExecutionRecordFromApi } = require('../lib/writeRecords/write-execution');
const { validateGranuleExecutionRequest } = require('../lib/request');

const log = new Logger({ sender: '@cumulus/api/executions' });

/**
 * create an execution
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function create(req, res) {
  const {
    executionPgModel = new ExecutionPgModel(),
    executionModel = new Execution(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const execution = req.body || {};
  const { arn } = execution;

  if (!arn) {
    return res.boom.badRequest('Field arn is missing');
  }

  if (await executionPgModel.exists(knex, { arn })) {
    return res.boom.conflict(`A record already exists for ${arn}`);
  }

  execution.updatedAt = Date.now();
  execution.createdAt = Date.now();

  try {
    await writeExecutionRecordFromApi({
      record: execution,
      knex,
      executionModel,
    });

    return res.send({
      message: `Successfully wrote execution with arn ${arn}`,
    });
  } catch (error) {
    log.error('Error occurred while trying to create execution:', error);
    if (isBadRequestError(error) || error instanceof RecordDoesNotExist) {
      return res.boom.badRequest(error.message);
    }
    return res.boom.badImplementation(error.message);
  }
}

/**
 * update an existing execution
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function update(req, res) {
  const arn = req.params.arn;
  const execution = req.body || {};

  if (arn !== execution.arn) {
    return res.boom.badRequest(`Expected execution arn to be '${arn}',`
      + ` but found '${execution.arn}' in payload`);
  }

  const {
    executionPgModel = new ExecutionPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  let oldPgRecord;
  try {
    oldPgRecord = await executionPgModel.get(knex, { arn });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
    return res.boom.notFound(`Execution '${arn}' not found`);
  }

  execution.updatedAt = Date.now();
  execution.createdAt = oldPgRecord.created_at.getTime();

  try {
    await writeExecutionRecordFromApi({ record: execution, knex });

    return res.send({
      message: `Successfully updated execution with arn ${arn}`,
    });
  } catch (error) {
    log.error('Error occurred while trying to update execution:', error);
    if (isBadRequestError(error) || error instanceof RecordDoesNotExist) {
      return res.boom.badRequest(error.message);
    }
    return res.boom.badImplementation(error.message);
  }
}

/**
 * List and search executions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  // const search = new Search(
  //   { queryStringParameters: req.query },
  //   'execution',
  //   process.env.ES_INDEX
  // );
  // const response = await search.query();
  // return res.send(response);
  const queryParameters = req.query;
  const perPage = Number.parseInt((queryParameters.limit) ? queryParameters.limit : 10, 10)
  const currentPage = Number.parseInt((queryParameters.page) ? queryParameters.page : 1, 10);
  const knex = await getKnexClient();
  const response = await knex('executions').paginate({
    perPage,
    currentPage,
  });
  const results = response.data;

  const queryResults = {
    results,
    meta: {
      ...response.pagination,
    }
  };

  return res.send(queryResults);
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
  const esExecutionsClient = new Search(
    {},
    'execution',
    process.env.ES_INDEX
  );

  let apiExecution;

  try {
    await executionPgModel.get(knex, { arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (!(await esExecutionsClient.exists(arn))) {
        log.info('Execution does not exist in Elasticsearch and PostgreSQL');
        return res.boom.notFound('No record found');
      }
      log.info('Execution does not exist in PostgreSQL, it only exists in Elasticsearch. Proceeding with deletion');
    } else {
      throw error;
    }
  }

  try {
    // Get DynamoDB execution in case of failure
    apiExecution = await executionModel.get({ arn });
  } catch (error) {
    // Don't throw an error if record doesn't exist
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  try {
    await createRejectableTransaction(knex, async (trx) => {
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

/**
 * Get execution history for a single granule or multiple granules
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function searchByGranules(req, res) {
  const payload = req.body;
  const knex = await getKnexClient();
  const granules = await getGranulesForPayload(payload, knex);
  const { page = 1, limit = 1, ...sortParams } = req.query;

  const offset = page < 1 ? 0 : (page - 1) * limit;

  const executionPgModel = new ExecutionPgModel();

  const executionCumulusIds = await getApiGranuleExecutionCumulusIds(knex, granules);

  const executions = await executionPgModel
    .searchByCumulusIds(knex, executionCumulusIds, { limit, offset, ...sortParams });

  const apiExecutions = await Promise.all(executions
    .map((execution) => translatePostgresExecutionToApiExecution(execution, knex)));

  const response = {
    meta: {
      count: apiExecutions.length,
    },
    results: apiExecutions,
  };

  return res.send(response);
}

/**
 * Get workflows for a single granule or intersection of workflows for multiple granules
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function workflowsByGranules(req, res) {
  const payload = req.body;
  const knex = await getKnexClient();
  const granules = await getGranulesForPayload(payload, knex);

  const granuleCumulusIds = await getApiGranuleCumulusIds(knex, granules);

  const workflowNames = await getWorkflowNameIntersectFromGranuleIds(knex, granuleCumulusIds);

  return res.send(workflowNames);
}

router.post('/search-by-granules', validateGranuleExecutionRequest, searchByGranules);
router.post('/workflows-by-granules', validateGranuleExecutionRequest, workflowsByGranules);
router.post('/', create);
router.put('/:arn', update);
router.get('/:arn', get);
router.get('/', list);
router.delete('/:arn', del);

module.exports = {
  del,
  router,
};
