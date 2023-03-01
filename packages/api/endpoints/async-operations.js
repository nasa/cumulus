'use strict';

const router = require('express-promise-router')();
const pick = require('lodash/pick');

const {
  AsyncOperationPgModel,
  getKnexClient,
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
  createRejectableTransaction,
} = require('@cumulus/db');
const {
  RecordDoesNotExist,
  ValidationError,
} = require('@cumulus/errors');
const {
  indexAsyncOperation,
} = require('@cumulus/es-client/indexer');

const Logger = require('@cumulus/logger');

const { Search } = require('@cumulus/es-client/search');
const { deleteAsyncOperation } = require('@cumulus/es-client/indexer');
const { AsyncOperation: AsyncOperationModel } = require('../models');
const { isBadRequestError } = require('../lib/errors');

const logger = new Logger({ sender: '@cumulus/api/asyncOperations' });

async function list(req, res) {
  const table = 'async_operations';
  const queryParameters = req.query;
  const perPage = Number.parseInt((queryParameters.limit) ? queryParameters.limit : 10, 10)
  const currentPage = Number.parseInt((queryParameters.page) ? queryParameters.page : 1, 10);
  const knex = await getKnexClient();
  const response = await knex('async_operations').paginate({
    perPage,
    currentPage,
  });
  const results = response.data;
  const translatedResults = results.map((asyncOperation) => translatePostgresAsyncOperationToApiAsyncOperation(asyncOperation));

  const queryResults = {
    results: translatedResults,
    meta: {
      ...response.pagination,
      table,
      stack: process.env.stackName,
      count: response.pagination.total,
      page: response.pagination.currentPage,
      limit: 10,
      // searchContext?
    }
  };

  return res.send(queryResults);
}

/**
 * Returns an express response containing the requested AsyncOperation
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function getAsyncOperation(req, res) {
  const knex = await getKnexClient();
  const asyncOperationPgModel = new AsyncOperationPgModel();
  let asyncOperationRecord;

  try {
    asyncOperationRecord = await asyncOperationPgModel.get(knex, { id: req.params.id });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) return res.boom.notFound(`Async Operation Record ${req.params.id} Not Found`);
    throw error;
  }
  const asyncOperation = translatePostgresAsyncOperationToApiAsyncOperation(asyncOperationRecord);

  return res.send(pick(asyncOperation, ['id', 'status', 'taskArn', 'description', 'operationType', 'output']));
}

/**
 * Delete an async operation
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    asyncOperationModel = new AsyncOperationModel({
      stackName: process.env.stackName,
      systemBucket: process.env.system_bucket,
      tableName: process.env.AsyncOperationsTable,
    }),
    asyncOperationPgModel = new AsyncOperationPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const { id } = req.params || {};
  const esAsyncOperationsClient = new Search(
    {},
    'asyncOperation',
    process.env.ES_INDEX
  );

  if (!id) {
    return res.boom.badRequest('id parameter is missing');
  }

  let existingApiAsyncOperation;
  try {
    await asyncOperationPgModel.get(knex, { id });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (!(await esAsyncOperationsClient.exists(id))) {
        logger.info('Async Operation does not exist in Elasticsearch and PostgreSQL');
        return res.boom.notFound('No record found');
      }
      logger.info('Async Operation does not exist in PostgreSQL, it only exists in Elasticsearch. Proceeding with deletion');
    } else {
      throw error;
    }
  }

  try {
    // Get DynamoDB async operation to recreate in case of deletion failure
    existingApiAsyncOperation = await asyncOperationModel.get({ id });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  try {
    await createRejectableTransaction(knex, async (trx) => {
      await asyncOperationPgModel.delete(trx, { id });
      await asyncOperationModel.delete({ id });
      await deleteAsyncOperation({
        esClient,
        id,
        index: process.env.ES_INDEX,
        ignore: [404],
      });
    });
  } catch (error) {
    // Delete is idempotent, so there may not be a DynamoDB
    // record to recreate
    if (existingApiAsyncOperation) {
      await asyncOperationModel.create(existingApiAsyncOperation);
    }
    throw error;
  }

  return res.send({ message: 'Record deleted' });
}

/**
 * Creates a new async operation
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    asyncOperationModel = new AsyncOperationModel({
      stackName: process.env.stackName,
      systemBucket: process.env.system_bucket,
      tableName: process.env.AsyncOperationsTable,
    }),
    asyncOperationPgModel = new AsyncOperationPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const apiAsyncOperation = req.body;

  apiAsyncOperation.createdAt = Date.now();
  apiAsyncOperation.updatedAt = Date.now();

  try {
    if (!apiAsyncOperation.id) {
      throw new ValidationError('Async Operations require an ID');
    }
    if (await asyncOperationPgModel.exists(knex, { id: apiAsyncOperation.id })) {
      return res.boom.conflict(`A record already exists for async operation ID ${apiAsyncOperation.id}`);
    }
    const dbRecord = translateApiAsyncOperationToPostgresAsyncOperation(apiAsyncOperation);
    let dynamoDbRecord;

    try {
      logger.debug(`Attempting to create async operation ${dbRecord.id}`);
      await createRejectableTransaction(knex, async (trx) => {
        await asyncOperationPgModel.create(trx, dbRecord);
        dynamoDbRecord = await asyncOperationModel.create(apiAsyncOperation);
        await indexAsyncOperation(esClient, dynamoDbRecord, process.env.ES_INDEX);
      });
    } catch (innerError) {
      // Clean up DynamoDB async operation record in case of any failure
      await asyncOperationModel.delete({ id: apiAsyncOperation.id });
      throw innerError;
    }
    logger.info(`Successfully created async operation ${dbRecord.id}:`);
    return res.send({
      message: 'Record saved',
      record: dynamoDbRecord,
    });
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.boom.badRequest(error.message);
    }

    logger.error('Error occurred while trying to create async operation:', error);
    return res.boom.badImplementation(error.message);
  }
}

router.get('/', list);
router.get('/:id', getAsyncOperation);
router.delete('/:id', del);
router.post('/', post);

module.exports = {
  del,
  post,
  router,
};
