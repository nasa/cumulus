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

const { Search, getEsClient } = require('@cumulus/es-client/search');
const { deleteAsyncOperation } = require('@cumulus/es-client/indexer');
const { isBadRequestError } = require('../lib/errors');

const { recordIsValid } = require('../lib/schema');
const asyncSchema = require('../lib/schemas').asyncOperation;

const logger = new Logger({ sender: '@cumulus/api/asyncOperations' });

async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'asyncOperation',
    process.env.ES_INDEX
  );

  const response = await search.query();
  return res.send(response);
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
    asyncOperationPgModel = new AsyncOperationPgModel(),
    knex = await getKnexClient(),
    esClient = await getEsClient(),
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

  await createRejectableTransaction(knex, async (trx) => {
    await asyncOperationPgModel.delete(trx, { id });
    await deleteAsyncOperation({
      esClient,
      id,
      index: process.env.ES_INDEX,
      ignore: [404],
    });
  });

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
    asyncOperationPgModel = new AsyncOperationPgModel(),
    knex = await getKnexClient(),
    esClient = await getEsClient(),
  } = req.testContext || {};

  const apiAsyncOperation = req.body;

  apiAsyncOperation.createdAt = Date.now();
  apiAsyncOperation.updatedAt = Date.now();

  try {
    if (!apiAsyncOperation.id) {
      throw new ValidationError('Async Operations require an ID');
    }
    recordIsValid(apiAsyncOperation, asyncSchema, false);
    if (await asyncOperationPgModel.exists(knex, { id: apiAsyncOperation.id })) {
      return res.boom.conflict(`A record already exists for async operation ID ${apiAsyncOperation.id}`);
    }
    const dbRecord = translateApiAsyncOperationToPostgresAsyncOperation(apiAsyncOperation);
    logger.debug(`Attempting to create async operation ${dbRecord.id}`);
    let apiDbRecord;
    await createRejectableTransaction(knex, async (trx) => {
      const pgRecord = await asyncOperationPgModel.create(trx, dbRecord, ['*']);
      apiDbRecord = await translatePostgresAsyncOperationToApiAsyncOperation(pgRecord[0]);
      await indexAsyncOperation(esClient, apiDbRecord, process.env.ES_INDEX);
    });
    logger.info(`Successfully created async operation ${apiDbRecord.id}:`);
    return res.send({
      message: 'Record saved',
      record: apiDbRecord,
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
