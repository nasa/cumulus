'use strict';

const router = require('express-promise-router')();
const pick = require('lodash.pick');

const { AsyncOperation: AsyncOperationModel } = require('../models');

async function list(req, res) {
  const asyncOperationModel = new AsyncOperationModel({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });

  const asyncOperationList = await asyncOperationModel.scan();
  res.send(asyncOperationList);
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
    tableName: process.env.AsyncOperationsTable
  });

  let asyncOperation;
  try {
    asyncOperation = await asyncOperationModel.get({ id: req.params.id });
  } catch (err) {
    if (err.message.startsWith('No record found')) return res.boom.notFound('Record Not Found');
    throw err;
  }

  return res.send(pick(asyncOperation, ['id', 'status', 'taskArn', 'description', 'operationType', 'output']));
}

router.get('/', list);
router.get('/:id', getAsyncOperation);

module.exports = router;
