'use strict';

const router = require('express-promise-router')();
const isBoolean = require('lodash/isBoolean');

const asyncOperations = require('@cumulus/async-operations');
const log = require('@cumulus/common/log');
const { inTestMode } = require('@cumulus/common/test-utils');
const {
  DeletePublishedGranule,
  RecordDoesNotExist,
} = require('@cumulus/errors');

const {
  CollectionPgModel,
  FilePgModel,
  getKnexClient,
  GranulePgModel,
  translateApiFiletoPostgresFile,
} = require('@cumulus/db');

const {
  moveGranuleFiles,
} = require('@cumulus/ingest/granule');

const {
  getBucketsConfigKey,
  getDistributionBucketMapKey,
} = require('@cumulus/common/stack');

const renameProperty = (from, to, obj) => {
  const newObj = { ...obj, [to]: obj[from] };
  delete newObj[from];
  return newObj;
};

const partial = require('lodash/partial');

const s3Utils = require('@cumulus/aws-client/S3');

const { deleteGranuleAndFiles } = require('../lib/granule-delete');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const Search = require('../es/search').Search;
const indexer = require('../es/indexer');
const models = require('../models');
const { deconstructCollectionId } = require('../lib/utils');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');

/**
 * List all granules for a given collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const es = new Search(
    { queryStringParameters: req.query },
    'granule',
    process.env.ES_INDEX
  );

  const result = await es.query();

  return res.send(result);
}

// TODO: put this in api/lib?
async function updateGranuleFilesInDataStore(apiGranule, granulesModel, updatedFiles) {
  try {
    const dbClient = await getKnexClient();
    const filesPgModel = new FilePgModel();
    const granulePgModel = new GranulePgModel();

    const postgresGranules = await granulePgModel.search(dbClient, [
      [{
        granule_id: apiGranule.granuleId,
      }],
    ]);
    // If there's a granule record in Postgres
    if (postgresGranules.length === 1) {
      let granuleModelUpdate;
      const granuleCumulusId = postgresGranules[0].cumulus_id;
      if (!granuleCumulusId) {
        // This is bad as files have moved, but the DB write failed.   Yikes.
        throw new Error('Granule returned without granule_id, cannot proceed with database write');
      }
      await dbClient.transaction(async (trx) => {
        // Delete all files associated with this granuleCumulusId
        // Again, we've already moved the files.   Yikes.
        await filesPgModel.delete(trx, { granule_cumulus_id: granuleCumulusId });
        await Promise.all(updatedFiles.map((file) => {
          // Translate dynamo file to postgres file
          const translatedFile = translateApiFiletoPostgresFile(file);
          return filesPgModel.upsert({ ...translatedFile, granule_cumulus_id: granuleCumulusId });
        }));
        // Call update, set files equal to updatedFiles in Dynamo
        granuleModelUpdate = granulesModel.update(
          { granuleId: apiGranule.granuleId },
          {
            files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
          }
        );
      });
      return granuleModelUpdate;
    }
    if (postgresGranules.length === 0) {
      // TODO abstract this
      return granulesModel.update(
        { granuleId: apiGranule.granuleId },
        {
          files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
        }
      );
    }
    throw new Error('Invalid return from postgres - multiple records matched granuleId search');
  } catch (error) {
    console.log(error);
    throw error;
  }
}

/**
 * Move a granule's files to destinations specified
 *
 * @param {Object} apiGranule - the granule record object
 * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
 *    - list of destinations specified
 *    regex - regex for matching filepath of file to new destination
 *    bucket - aws bucket of the destination
 *    filepath - file path/directory on the bucket for the destination
 * @param {string} distEndpoint - distribution endpoint URL
 * @param {Object} granulesModel - An instance of an API Granule granulesModel
 * @returns {Promise<undefined>} undefined
 */
async function moveGranule(apiGranule, destinations, distEndpoint, granulesModel) {
  log.info(`granules.move ${apiGranule.granuleId}`);

  const bucketsConfig = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    getBucketsConfigKey(process.env.stackName)
  );

  const bucketTypes = Object.values(bucketsConfig)
    .reduce(
      (acc, { name, type }) => ({ ...acc, [name]: type }),
      {}
    );

  const distributionBucketMap = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    getDistributionBucketMapKey(process.env.stackName)
  );

  // TODO: This is *terrible* -
  //  it has a Promise.all with no rollback of any sort if a file move fails.
  const updatedFiles = await moveGranuleFiles(g.files, destinations);
  await granulesModel.cmrUtils.reconcileCMRMetadata({
    granuleId: apiGranule.granuleId,
    updatedFiles,
    distEndpoint,
    published: apiGranule.published,
    distributionBucketMap,
    bucketTypes,
  });

  await updateGranuleFilesInDataStore(apiGranule, granulesModel, updatedFiles);
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

    await granuleModelClient.reingest({
      ...granule,
      queueUrl: process.env.backgroundQueueUrl,
    });

    const response = {
      action,
      granuleId: granule.granuleId,
      status: 'SUCCESS',
    };

    if (collection.duplicateHandling !== 'replace') {
      response.warning = 'The granule files may be overwritten';
    }

    return res.send(response);
  }

  if (action === 'applyWorkflow') {
    await granuleModelClient.applyWorkflow(
      granule,
      body.workflow,
      body.meta
    );

    return res.send({
      granuleId: granule.granuleId,
      action: `applyWorkflow ${body.workflow}`,
      status: 'SUCCESS',
    });
  }

  if (action === 'removeFromCmr') {
    const knex = await getKnexClient({ env: process.env });

    await unpublishGranule(knex, granule);

    return res.send({
      granuleId: granule.granuleId,
      action,
      status: 'SUCCESS',
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

    // await granuleModelClient.move(granule, body.destinations, process.env.DISTRIBUTION_ENDPOINT);
    await moveGranule(
      granule,
      body.destinations,
      process.env.DISTRIBUTION_ENDPOINT,
      granuleModelClient
    );

    return res.send({
      granuleId: granule.granuleId,
      action,
      status: 'SUCCESS',
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
  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();

  const knex = await getKnexClient({ env: process.env });

  let dynamoGranule;
  let pgGranule;

  // If the granule does not exist in Dynamo, throw an error
  try {
    dynamoGranule = await granuleModelClient.getRecord({ granuleId });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(error);
    }
    throw error;
  }

  // If the granule does not exist in PG, just log that information. The logic that
  // actually handles Dynamo/PG granule deletion will skip the PG deletion if the record
  // does not exist. see deleteGranuleAndFiles().
  try {
    if (dynamoGranule.collectionId) {
      const { name, version } = deconstructCollectionId(dynamoGranule.collectionId);
      const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
        knex,
        { name, version }
      );
      // Need granule_id + collection_cumulus_id to get truly unique record.
      pgGranule = await granulePgModel.get(knex, {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      });
    }
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.info(`Postgres Granule with ID ${granuleId} does not exist`);
    } else {
      throw error;
    }
  }

  if (dynamoGranule.published) {
    throw new DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
  }

  await deleteGranuleAndFiles({
    knex,
    dynamoGranule,
    pgGranule,
  });

  if (inTestMode()) {
    const esClient = await Search.es(process.env.ES_HOST);
    await indexer.deleteRecord({
      esClient,
      id: granuleId,
      type: 'granule',
      parent: dynamoGranule.collectionId,
      index: process.env.ES_INDEX,
      ignore: [404],
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
  } catch (error) {
    if (error.message.startsWith('No record found')) {
      return res.boom.notFound('Granule not found');
    }

    throw error;
  }

  return res.send(result);
}

function validateBulkGranulesRequest(req, res, next) {
  const payload = req.body;

  if (!payload.ids && !payload.query) {
    return res.boom.badRequest('One of ids or query is required');
  }

  if (payload.ids && !Array.isArray(payload.ids)) {
    return res.boom.badRequest(`ids should be an array of values, received ${payload.ids}`);
  }

  if (!payload.query && payload.ids && payload.ids.length === 0) {
    return res.boom.badRequest('no values provided for ids');
  }

  if (payload.query
    && !(process.env.METRICS_ES_HOST
        && process.env.METRICS_ES_USER
        && process.env.METRICS_ES_PASS)
  ) {
    return res.boom.badRequest('ELK Metrics stack not configured');
  }

  if (payload.query && !payload.index) {
    return res.boom.badRequest('Index is required if query is sent');
  }

  return next();
}

async function bulkOperations(req, res) {
  const payload = req.body;

  if (!payload.workflowName) {
    return res.boom.badRequest('workflowName is required.');
  }
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;

  let description;
  if (payload.query) {
    description = `Bulk run ${payload.workflowName} on ${payload.query.size} granules`;
  } else if (payload.ids) {
    description = `Bulk run ${payload.workflowName} on ${payload.ids.length} granules`;
  } else {
    description = `Bulk run on ${payload.workflowName}`;
  }

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.BulkOperationLambda,
    description,
    operationType: 'Bulk Granules',
    payload: {
      payload,
      type: 'BULK_GRANULE',
      envVars: {
        GranulesTable: process.env.GranulesTable,
        system_bucket: process.env.system_bucket,
        stackName: process.env.stackName,
        invoke: process.env.invoke,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
      },
    },
    esHost: process.env.ES_HOST,
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, models.AsyncOperation);

  return res.status(202).send(asyncOperation);
}

/**
 * Start an AsyncOperation that will perform a bulk granules delete
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function bulkDelete(req, res) {
  const payload = req.body;

  if (payload.forceRemoveFromCmr && !isBoolean(payload.forceRemoveFromCmr)) {
    return res.boom.badRequest('forceRemoveFromCmr must be a boolean value');
  }

  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.BulkOperationLambda,
    description: 'Bulk granule deletion',
    operationType: 'Bulk Granule Delete', // this value is set on an ENUM field, so cannot change
    payload: {
      type: 'BULK_GRANULE_DELETE',
      payload,
      envVars: {
        cmr_client_id: process.env.cmr_client_id,
        CMR_ENVIRONMENT: process.env.CMR_ENVIRONMENT,
        cmr_oauth_provider: process.env.cmr_oauth_provider,
        cmr_password_secret_name: process.env.cmr_password_secret_name,
        cmr_provider: process.env.cmr_provider,
        cmr_username: process.env.cmr_username,
        GranulesTable: process.env.GranulesTable,
        launchpad_api: process.env.launchpad_api,
        launchpad_certificate: process.env.launchpad_certificate,
        launchpad_passphrase_secret_name: process.env.launchpad_passphrase_secret_name,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, models.AsyncOperation);

  return res.status(202).send(asyncOperation);
}

async function bulkReingest(req, res) {
  const payload = req.body;
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;

  const numOfGranules = (payload.query && payload.query.size)
    || (payload.ids && payload.ids.length);
  const description = `Bulk granule reingest run on ${numOfGranules || ''} granules`;

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.BulkOperationLambda,
    description,
    operationType: 'Bulk Granule Reingest',
    payload: {
      payload,
      type: 'BULK_GRANULE_REINGEST',
      envVars: {
        GranulesTable: process.env.GranulesTable,
        system_bucket: process.env.system_bucket,
        stackName: process.env.stackName,
        invoke: process.env.invoke,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
      },
    },
    esHost: process.env.ES_HOST,
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, models.AsyncOperation);

  return res.status(202).send(asyncOperation);
}

router.get('/:granuleName', get);
router.get('/', list);
router.put('/:granuleName', put);
router.post(
  '/bulk',
  validateBulkGranulesRequest,
  bulkOperations,
  asyncOperationEndpointErrorHandler
);
router.post(
  '/bulkDelete',
  validateBulkGranulesRequest,
  bulkDelete,
  asyncOperationEndpointErrorHandler
);
router.post(
  '/bulkReingest',
  validateBulkGranulesRequest,
  bulkReingest,
  asyncOperationEndpointErrorHandler
);
router.delete('/:granuleName', del);

module.exports = router;
