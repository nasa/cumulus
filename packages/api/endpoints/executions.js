//@ts-check

'use strict';

const router = require('express-promise-router')();
const { v4: uuidv4 } = require('uuid');

const startAsyncOperation = require('../lib/startAsyncOperation');
const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const {
  getKnexClient,
  getApiGranuleExecutionCumulusIds,
  getApiGranuleCumulusIds,
  getWorkflowNameIntersectFromGranuleIds,
  CollectionPgModel,
  ExecutionPgModel,
  translatePostgresExecutionToApiExecution,
  createRejectableTransaction,
} = require('@cumulus/db');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const { deleteExecution } = require('@cumulus/es-client/indexer');
const { getEsClient, Search } = require('@cumulus/es-client/search');

const { isBadRequestError } = require('../lib/errors');
const { getGranulesForPayload } = require('../lib/granules');
const { writeExecutionRecordFromApi } = require('../lib/writeRecords/write-execution');
const { validateGranuleExecutionRequest, getFunctionNameFromRequestContext } = require('../lib/request');

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
    executionPgModel = new ExecutionPgModel(),
    knex = await getKnexClient(),
    esClient = await getEsClient(),
  } = req.testContext || {};

  const { arn } = req.params;
  const esExecutionsClient = new Search(
    {},
    'execution',
    process.env.ES_INDEX
  );

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

  await createRejectableTransaction(knex, async (trx) => {
    await executionPgModel.delete(trx, { arn });
    await deleteExecution({
      esClient,
      arn,
      index: process.env.ES_INDEX,
      ignore: [404],
    });
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

async function bulkDeleteExecutionsByCollection(req, res) {
  // TODO: add zod parser for bulk delete payload
  const payload = req.body;

  // TODO: Type this properly
  // Payload is  {batchsize: number/string } only

  const batchSize = payload.batchSize || 5000;
  const collectionId = req.params.collectionId;
  const collectionPgModel = new CollectionPgModel();

  // TODO: Verify RDS collection exists using collectionId DONE
  // TODO: Abstract this as granule endpoint uses same thing, more or less
  if (!payload.collectionId) {
    res.boom.badRequest('Granule update must include a valid CollectionId');
  }
  try {
    const knex = await getKnexClient();
    await collectionPgModel.get(
      knex,
      deconstructCollectionId(collectionId)
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(
        `collectionId ${collectionId} does not exist, cannot delete exeuctions`
      );
      res.boom.badRequest(
        `collectionId ${collectionId} is invalid`
      );
    } else {
      throw error;
    }
  }

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description: 'Bulk Execution Deletion by CollectionId',
    operationType: 'Bulk Execution Delete',
    payload: {
      type: 'BULK_EXECUTION_DELETE',
      payload: { ...payload, batchSize, collectionId },
      envVars: {
        ES_HOST: process.env.ES_HOST,
        KNEX_DEBUG: payload.knexDebug ? 'true' : 'false',
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
  };

  log.debug(
    `About to invoke lambda to start async operation ${asyncOperationId}`
  );
  await startAsyncOperation.invokeStartAsyncOperationLambda(
    asyncOperationEvent
  );
  return res.status(202).send({ id: asyncOperationId });
}

router.post('/search-by-granules', validateGranuleExecutionRequest, searchByGranules);
router.post('/workflows-by-granules', validateGranuleExecutionRequest, workflowsByGranules);
// TODO: Add validation routine/error handler
router.post('/bulk-delete-by-collection/:collectionId', bulkDeleteExecutionsByCollection);
router.post('/', create);
router.put('/:arn', update);
router.get('/:arn', get);
router.get('/', list);
router.delete('/:arn', del);

module.exports = {
  del,
  router,
};
