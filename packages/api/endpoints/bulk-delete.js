'use strict';

const router = require('express-promise-router')();
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

  let asyncOperation;
  try {
    asyncOperation = await asyncOperationModel.start({
      asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
      cluster: process.env.EcsCluster,
      lambdaName: process.env.BulkDeleteLambda,
      payload: { granuleIds: req.body.granuleIds }
    });
  }
  catch (err) {
    if (err.name !== 'EcsStartTaskError') throw err;

    return res.boom.serverUnavailable(`Failed to run ECS task: ${err.message}`);
  }

  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

router.post('/', startBulkDeleteAsyncOperation);

module.exports = router;
