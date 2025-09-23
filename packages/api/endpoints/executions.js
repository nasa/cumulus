//@ts-check

'use strict';

const router = require('express-promise-router');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const isError = require('lodash/isError');

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
  ExecutionSearch,
} = require('@cumulus/db');
const { deconstructCollectionId } = require('@cumulus/message/Collections');

const { zodParser } = require('../src/zod-utils');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const startAsyncOperation = require('../lib/startAsyncOperation');
const { isBadRequestError } = require('../lib/errors');
const { getGranulesForPayload } = require('../lib/granules');
const { returnCustomValidationErrors } = require('../lib/endpoints');
const { writeExecutionRecordFromApi } = require('../lib/writeRecords/write-execution');
const { validateGranuleExecutionRequest, getFunctionNameFromRequestContext } = require('../lib/request');

const log = new Logger({ sender: '@cumulus/api/executions' });

const BulkExecutionDeletePayloadSchema = z.object({
  esBatchSize: z.union([
    z.string().transform((val) => {
      const num = Number(val);
      if (Number.isNaN(num)) {
        throw new TypeError('Invalid number');
      }
      return num;
    }),
    z.number(),
  ]).pipe(z.number().int().positive().optional()),
  dbBatchSize: z.union([
    z.string().transform((val) => {
      const num = Number(val);
      if (Number.isNaN(num)) {
        throw new TypeError('Invalid number');
      }
      return num;
    }),
    z.number(),
  ]).pipe(z.number().int().positive().optional()),
  knexDebug: z.boolean().optional(),
  collectionId: z.string(),
}).catchall(z.unknown());

const parseBulkDeletePayload = zodParser('Bulk Execution Delete Payload', BulkExecutionDeletePayloadSchema);

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
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const search = new ExecutionSearch({ queryStringParameters: req.query });
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
 * Does *not* publish execution deletion event to SNS topic
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    executionPgModel = new ExecutionPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const { arn } = req.params;

  try {
    await executionPgModel.get(knex, { arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.info('Execution does not exist in PostgreSQL');
      return res.boom.notFound('No record found');
    }
    throw error;
  }

  await executionPgModel.delete(knex, { arn });

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
  const granules = await getGranulesForPayload(payload);
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
  const granules = await getGranulesForPayload(payload);

  const granuleCumulusIds = await getApiGranuleCumulusIds(knex, granules);

  const workflowNames = await getWorkflowNameIntersectFromGranuleIds(knex, granuleCumulusIds);

  return res.send(workflowNames);
}

/**
 * Deletes execution records in bulk for a specific collection.
 *
 * Does *not* publish execution deletion event to SNS topic
 *
 * @param {Object} req - The request object.
 * @param {Object} req.params - The request parameters.
 * @param {Object} req.body - The request body.
 * @param {number|string} [req.body.dbBatchSize=10000] - The number of records to delete
 * in each batch.
 * @param {string} req.body.collectionId - The CollectionID to delete execution records for.
 * @param {string} [req.body.knexDebug=false] - Boolean to enabled Knex Debugging for the request
 * @param {Object} [req.testObject] - Object to allow for dependency injection in tests
 * @Param {Function} [req.testObject.invokeStartAsyncOperationLambda] - Function to invoke
 * the startAsyncOperation Lambda
 * @param {Object} res - The response object.
 */
async function bulkDeleteExecutionsByCollection(req, res) {
  const invokeStartAsyncOperationLambda =
    req?.testObject?.invokeStartAsyncOperationLambda ||
    startAsyncOperation.invokeStartAsyncOperationLambda;
  const payload = parseBulkDeletePayload(req.body);
  if (isError(payload)) {
    return returnCustomValidationErrors(res, payload);
  }

  const dbBatchSize = payload.dbBatchSize || 10000;
  const collectionId = req.body.collectionId;
  const collectionPgModel = new CollectionPgModel();

  if (!collectionId) {
    res.boom.badRequest('Execution update must include a valid CollectionId');
  }
  try {
    log.info(`Collection ID Is ${collectionId}`);
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
      res.boom.badRequest(error.message);
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
      payload: { ...payload, dbBatchSize, collectionId },
      envVars: {
        KNEX_DEBUG: payload.knexDebug ? 'true' : 'false',
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
  };

  log.debug(
    `About to invoke lambda to start async operation ${asyncOperationId}`
  );
  await invokeStartAsyncOperationLambda(
    asyncOperationEvent
  );
  return res.status(202).send({ id: asyncOperationId });
}

const bulkArchiveExecutionsSchema = z.object({
  updateLimit: z.number().optional().default(10000),
  batchSize: z.number().optional().default(1000),
  expirationDays: z.number().optional().default(365),
});
const parseBulkArchiveExecutionsPayload = zodParser('bulkChangeCollection payload', bulkArchiveExecutionsSchema);
/**
 * Start an AsyncOperation that will archive a set of executions in ecs
 */
async function bulkArchiveExecutions(req, res) {
  const payload = parseBulkArchiveExecutionsPayload(req.body);
  if (isError(payload)) {
    return returnCustomValidationErrors(res, payload);
  }
  if (payload.updateLimit === 0) {
    // don't bother running an ecs task to do nothing
    return res.status(202).send({});
  }
  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.ArchiveRecordsLambda,
    description: 'Launches an ecs task to archive a batch of executions',
    operationType: 'Bulk Execution Archive',
    payload: {
      config: {
        ...payload,
        recordType: 'executions',
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

router.patch('/archive', bulkArchiveExecutions);
router.post('/search-by-granules', validateGranuleExecutionRequest, searchByGranules);
router.post('/workflows-by-granules', validateGranuleExecutionRequest, workflowsByGranules);
router.post(
  '/bulk-delete-by-collection/',
  bulkDeleteExecutionsByCollection,
  asyncOperationEndpointErrorHandler
);
router.post('/', create);
router.put('/:arn', update);
router.get('/:arn', get);
router.get('/', list);
router.delete('/:arn', del);

module.exports = {
  del,
  router,
  bulkArchiveExecutions,
  bulkDeleteExecutionsByCollection,
};
