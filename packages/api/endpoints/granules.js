'use strict';

const router = require('express-promise-router')();
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const { inTestMode } = require('@cumulus/common/test-utils');
const Search = require('../es/search').Search;
const indexer = require('../es/indexer');
const models = require('../models');
const { deconstructCollectionId } = require('../lib/utils');

/**
 * List all granules for a given collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const result = await (new Search({
    queryStringParameters: req.query
  }, 'granule')).query();

  return res.send(result);
}

/**
 * Update a single granule.
 * Supported Actions: reingest, move, applyWorkflow, RemoveFromCMR.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  const granuleId = req.params.granuleName;
  const body = req.body;
  const action = body.action;

  if (!action) {
    return res.boom.badRequest('Action is missing');
  }

  const granuleModelClient = new models.Granule();
  const granule = await granuleModelClient.get({ granuleId });

  if (action === 'reingest') {
    const { name, version } = deconstructCollectionId(granule.collectionId);
    const collectionModelClient = new models.Collection();
    const collection = await collectionModelClient.get({ name, version });

    await granuleModelClient.reingest({ ...granule, queueName: process.env.backgroundQueueName });

    const warning = 'The granule files may be overwritten';

    return res.send(Object.assign({
      granuleId: granule.granuleId,
      action,
      status: 'SUCCESS'
    },
    (collection.duplicateHandling !== 'replace') ? { warning } : {}));
  }

  if (action === 'applyWorkflow') {
    await granuleModelClient.applyWorkflow(
      granule,
      body.workflow
    );

    return res.send({
      granuleId: granule.granuleId,
      action: `applyWorkflow ${body.workflow}`,
      status: 'SUCCESS'
    });
  }

  if (action === 'removeFromCmr') {
    await granuleModelClient.removeGranuleFromCmrByGranule(granule);

    return res.send({
      granuleId: granule.granuleId,
      action,
      status: 'SUCCESS'
    });
  }

  if (action === 'move') {
    const filesAtDestination = await granuleModelClient.getFilesExistingAtLocation(
      granule,
      body.destinations
    );

    if (filesAtDestination.length > 0) {
      const filenames = filesAtDestination.map((file) => file.fileName);
      const message = `Cannot move granule because the following files would be overwritten at the destination location: ${filenames.join(', ')}. Delete the existing files or reingest the source files.`;

      return res.boom.conflict(message);
    }

    await granuleModelClient.move(granule, body.destinations, process.env.DISTRIBUTION_ENDPOINT);

    return res.send({
      granuleId: granule.granuleId,
      action,
      status: 'SUCCESS'
    });
  }

  return res.boom.badRequest('Action is not supported. Choices are "applyWorkflow", "move", "reingest", or "removeFromCmr"');
}

/**
 * Delete a granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const granuleId = req.params.granuleName;
  log.info(`granules.del ${granuleId}`);

  const granuleModelClient = new models.Granule();
  const granule = await granuleModelClient.get({ granuleId });

  if (granule.detail) {
    return res.boom.badRequest(granule);
  }

  if (granule.published) {
    return res.boom.badRequest('You cannot delete a granule that is published to CMR. Remove it from CMR first');
  }

  // remove files from s3
  if (granule.files) {
    await Promise.all(granule.files.map(async (file) => {
      if (await aws.fileExists(file.bucket, file.key)) {
        return aws.deleteS3Object(file.bucket, file.key);
      }
      return {};
    }));
  }

  await granuleModelClient.delete({ granuleId });

  if (inTestMode()) {
    const esClient = await Search.es(process.env.ES_HOST);
    const esIndex = process.env.esIndex;
    await indexer.deleteRecord({
      esClient,
      id: granuleId,
      type: 'granule',
      parent: granule.collectionId,
      index: esIndex,
      ignore: [404]
    });
  }

  return res.send({ detail: 'Record deleted' });
}

/**
 * Query a single granule.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  let result;
  try {
    result = await (new models.Granule()).get({ granuleId: req.params.granuleName });
  } catch (err) {
    if (err.message.startsWith('No record found')) {
      return res.boom.notFound('Granule not found');
    }

    throw err;
  }

  return res.send(result);
}

async function bulk(req, res) {
  const payload = req.body;

  if (!payload.workflowName) {
    return res.boom.badRequest('workflowName is required.');
  }

  if (!payload.ids && !payload.query) {
    return res.boom.badRequest('One of ids or query is required');
  }

  if (payload.query
    && !(process.env.METRICS_ES_HOST
    && process.env.METRICS_ES_USER
    && process.env.METRICS_ES_PASS)) {
    return res.boom.badRequest('ELK Metrics stack not configured');
  }

  if (payload.query && !payload.index) {
    return res.boom.badRequest('Index is required if query is sent');
  }

  const asyncOperationModel = new models.AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });

  try {
    const asyncOperation = await asyncOperationModel.start({
      asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
      cluster: process.env.EcsCluster,
      lambdaName: process.env.BulkOperationLambda,
      payload: {
        payload,
        type: 'BULK_GRANULE',
        granulesTable: process.env.GranulesTable,
        system_bucket: process.env.system_bucket,
        stackName: process.env.stackName,
        invoke: process.env.invoke,
        esHost: process.env.METRICS_ES_HOST,
        esUser: process.env.METRICS_ES_USER,
        esPassword: process.env.METRICS_ES_PASS
      },
      esHost: process.env.ES_HOST
    });

    return res.send(asyncOperation);
  } catch (err) {
    if (err.name !== 'EcsStartTaskError') throw err;

    return res.boom.serverUnavailable(`Failed to run ECS task: ${err.message}`);
  }
}

router.get('/:granuleName', get);
router.get('/', list);
router.put('/:granuleName', put);
router.post('/bulk', bulk);
router.delete('/:granuleName', del);

module.exports = router;
