'use strict';

const router = require('express-promise-router')();

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { AsyncOperation } = require('../models');

/**
 * Start an AsyncOperation that will perform a bulk delete
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function startBulkDeleteAsyncOperation(req, res) {
  const asyncOperationModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });

  const asyncOperation = await asyncOperationModel.start({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.BulkDeleteLambda,
    description: 'Bulk Delete',
    operationType: 'Bulk Delete',
    payload: { granuleIds: req.body.granuleIds }
  });

  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

router.post('/', startBulkDeleteAsyncOperation, asyncOperationEndpointErrorHandler);

module.exports = router;
