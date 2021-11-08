'use strict';

const router = require('express-promise-router')();
const pick = require('lodash/pick');

const {
  AsyncOperationPgModel,
  getKnexClient,
  createRejectableTransaction,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
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
async function deleteAsyncOperation(req, res) {
  const {
    asyncOperationModel = new AsyncOperationModel({
      stackName: process.env.stackName,
      systemBucket: process.env.system_bucket,
      tableName: process.env.AsyncOperationsTable,
    }),
    asyncOperationPgModel = new AsyncOperationPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const { id } = req.params || {};

  if (!id) {
    return res.boom.badRequest('id parameter is missing');
  }

  await createRejectableTransaction(knex, async (trx) => {
    await asyncOperationPgModel.delete(trx, { id });
    await asyncOperationModel.delete({ id });
  });
  return res.send({ message: 'Record deleted' });
}

router.get('/', list);
router.get('/:id', getAsyncOperation);
router.delete('/:id', deleteAsyncOperation);

module.exports = {
  router,
  deleteAsyncOperation,
};
