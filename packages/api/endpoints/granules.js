'use strict';

const router = require('express-promise-router')();
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const elasticsearch = require('elasticsearch');
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
  const data = req.body
  console.log(req.body);

  // In practice this is going to change - page through results and queue
  // send request to Kibana
  const query = data.query;
  const index = data.index;
  const response = {
    hits: {
      hits: [
        { "name": "jacob", "dr": "dre", "granuleId": "L2_HR_PIXC_product_0001-of-4154" },
        { "name": "bocaj", "who": "are you", "granuleId": "MOD09GQ.A5252833.awVbJG.006.4578722030158" }
      ]
    }
  };
  const hits = response.hits.hits;
  console.log(response);

  // add the response to a priority SQS queue
  const queueName = data.queueName;
  const workflowName = data.workflowName;
  const granuleModelClient = new models.Granule();

  // const client = new elasticsearch.Client({
  //   host: [
  //     {
  //       host: process.env.METRICS_ES_HOST,
  //       auth: process.env.METRICS_ES_AUTH,
  //       protocol: 'https',
  //       port: 443
  //     }
  //   ]
  // });

  // const result = await client.search({
  //   index: index,
  //   body: query
  // });

  // console.log(result);

  // const applyWorkflowRequests = response.filter((item) => item._source.granuleId)
  //   .map(async (item) => {
  //     const granule = await granuleModelClient.get({ granuleId: item._source.granuleId });
  //     return granuleModelClient.applyWorkflow(granule, workflowName, queueName);
  //   });

  const applyWorkflowRequests = hits.filter((item) => item.granuleId)
      .map(async (item) => {
        const granule = await granuleModelClient.get({ granuleId: item.granuleId });
        return granuleModelClient.applyWorkflow(granule, workflowName, queueName);
      });

  await Promise.all(applyWorkflowRequests);
  res.send(`On my wings! Workflow ${queueName}. \nResponse: ${JSON.stringify(response)}`);
}

router.get('/:granuleName', get);
router.get('/', list);
router.put('/:granuleName', put);
router.post('/bulk', bulk);
router.delete('/:granuleName', del);

module.exports = router;
