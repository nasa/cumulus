'use strict';

const router = require('express-promise-router')();
const pick = require('lodash/pick');

const {
  AsyncOperationPgModel,
  getKnexClient,
} = require('@cumulus/db');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { Search } = require('@cumulus/es-client/search');
const { deleteAsyncOperation } = require('@cumulus/es-client/indexer');
const { AsyncOperation: AsyncOperationModel } = require('../models');

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
  const asyncOperationModel = new AsyncOperationModel({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable,
  });

  let asyncOperation;
  try {
    asyncOperation = await asyncOperationModel.get({ id: req.params.id });
  } catch (error) {
    if (error.message.startsWith('No record found')) return res.boom.notFound('Record Not Found');
    throw error;
  }

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

  if (!id) {
    return res.boom.badRequest('id parameter is missing');
  }

  let existingAsyncOperation;
  try {
    existingAsyncOperation = await asyncOperationModel.get({ id });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('No record found');
    }
    throw error;
  }

  try {
    await knex.transaction(async (trx) => {
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
    if (existingAsyncOperation) {
      await asyncOperationModel.create(existingAsyncOperation);
    }
    throw error;
  }

  return res.send({ message: 'Record deleted' });
}

router.get('/', list);
router.get('/:id', getAsyncOperation);
router.delete('/:id', del);

module.exports = {
  router,
  del,
};
