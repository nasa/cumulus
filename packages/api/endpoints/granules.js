'use strict';

const router = require('express-promise-router')();
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const Search = require('../es/search').Search;
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

    await granuleModelClient.reingest(granule);

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
  await Promise.all(granule.files.map((file) => {
    if (aws.fileExists(file.bucket, file.key)) {
      return aws.deleteS3Object(file.bucket, file.key);
    }

    return {};
  }));

  await granuleModelClient.delete({ granuleId });

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

router.get('/:granuleName', get);
router.get('/', list);
router.put('/:granuleName', put);
router.delete('/:granuleName', del);

module.exports = router;
