'use strict';

const router = require('express-promise-router')();
const isBoolean = require('lodash/isBoolean');
const omit = require('lodash/omit');

const asyncOperations = require('@cumulus/async-operations');
const Logger = require('@cumulus/logger');
const { inTestMode } = require('@cumulus/common/test-utils');
const {
  addToLocalES,
  indexGranule,
} = require('@cumulus/es-client/indexer');
const {
  DeletePublishedGranule,
  RecordDoesNotExist,
} = require('@cumulus/errors');

const {
  CollectionPgModel,
  getKnexClient,
  GranulePgModel,
} = require('@cumulus/db');

const Search = require('@cumulus/es-client/search').Search;
const indexer = require('@cumulus/es-client/indexer');

const { deleteGranuleAndFiles } = require('../src/lib/granule-delete');
const { chooseTargetExecution } = require('../lib/executions');
const { writeGranuleFromApi } = require('../lib/writeRecords/write-granules');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const models = require('../models');
const { deconstructCollectionId, errorify } = require('../lib/utils');
const { moveGranule } = require('../lib/granules');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const { addOrcaRecoveryStatus, getOrcaRecoveryStatusByGranuleId } = require('../lib/orca');
const { validateBulkGranulesRequest } = require('../lib/request');

const log = new Logger({ sender: '@cumulus/api' });

/**
 * List all granules for a given collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const { getRecoveryStatus, ...queryStringParameters } = req.query;
  const es = new Search(
    { queryStringParameters },
    'granule',
    process.env.ES_INDEX
  );

  let result = await es.query();
  if (getRecoveryStatus === 'true') {
    result = await addOrcaRecoveryStatus(result);
  }

  return res.send(result);
}

/**
 * Create new granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const create = async (req, res) => {
  const {
    knex = await getKnexClient(),
    granuleModel = new models.Granule(),
  } = req.testContext || {};

  const granule = req.body || {};

  try {
    if (await granuleModel.exists({ granuleId: granule.granuleId })) {
      return res.boom.conflict(`A granule already exists for granule_id: ${granule.granuleId}`);
    }
  } catch (error) {
    return res.boom.badRequest(errorify(error));
  }

  try {
    await writeGranuleFromApi(granule, knex);
    if (inTestMode()) {
      await addToLocalES(granule, indexGranule);
    }
  } catch (error) {
    log.error('Could not write granule', error);
    return res.boom.badRequest(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  }
  return res.send({ message: `Successfully wrote granule with Granule Id: ${granule.granuleId}` });
};

/**
 * Update existing granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const putGranule = async (req, res) => {
  const {
    granuleModel = new models.Granule(),
    knex = await getKnexClient(),
  } = req.testContext || {};
  const body = req.body || {};

  let existingGranule;
  let message;
  let status;
  try {
    existingGranule = await granuleModel.get({ granuleId: body.granuleId });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      status = 201;
      message = `Successfully wrote granule with Granule Id: ${body.granuleId}`;
    } else {
      return res.boom.badRequest(errorify(error));
    }
  }

  let updatedGranule = body;
  if (body.status === 'queued' && existingGranule) {
    updatedGranule = {
      ...omit(existingGranule, ['updatedAt', 'timestamp', 'provider']),
      ...body,
    };
  }

  try {
    await writeGranuleFromApi(updatedGranule, knex);
  } catch (error) {
    log.error('failed to update granule', error);
    return res.boom.badRequest(errorify(error));
  }
  return res.status(status || 200).send({
    message: message || `Successfully updated granule with Granule Id: ${body.granuleId}`,
  });
};

/**
 * Update a single granule.
 * Supported Actions: reingest, move, applyWorkflow, RemoveFromCMR.
 * If no action is included on the request, the body is assumed to be an
 * existing granule to update, and update is called with the input parameters.
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
    if (req.body.granuleId === req.params.granuleName) {
      return putGranule(req, res);
    }
    return res.boom.badRequest(
      `input :granuleName (${req.params.granuleName}) must match body's granuleId (${req.body.granuleId})`
    );
  }

  const granuleModelClient = new models.Granule();
  const granule = await granuleModelClient.get({ granuleId });

  if (action === 'reingest') {
    const { name, version } = deconstructCollectionId(granule.collectionId);
    const collectionModelClient = new models.Collection();
    const collection = await collectionModelClient.get({ name, version });
    let targetExecution;
    try {
      targetExecution = await chooseTargetExecution({
        granuleId, executionArn: body.executionArn, workflowName: body.workflowName,
      });
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return res.boom.badRequest(`Cannot reingest granule: ${error.message}`);
      }
      throw error;
    }

    if (targetExecution) {
      log.info(`targetExecution has been specified for granule (${granuleId}) reingest: ${targetExecution}`);
    }

    await granuleModelClient.reingest({
      ...granule,
      ...(targetExecution && { execution: targetExecution }),
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
  return res.boom.badRequest('Action is not supported. Choices are "applyWorkflow", "move", "reingest", "removeFromCmr" or specify no "action" to update an existing granule');
}

/**
 * associate an execution with a granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object
 */
const associateExecution = async (req, res) => {
  const granuleName = req.params.granuleName;

  const { collectionId, granuleId, executionArn } = req.body || {};
  if (!granuleId || !collectionId || !executionArn) {
    return res.boom.badRequest('Field granuleId, collectionId or executionArn is missing from request body');
  }

  if (granuleName !== granuleId) {
    return res.boom.badRequest(`Expected granuleId to be ${granuleName} but found ${granuleId} in payload`);
  }

  const {
    executionModel = new models.Execution(),
    granuleModel = new models.Granule(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  let granule;
  let execution;
  try {
    granule = await granuleModel.get({ granuleId });
    execution = await executionModel.get({ arn: executionArn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (granule === undefined) {
        return res.boom.notFound(`No granule found to associate execution with for granuleId ${granuleId}`);
      }
      return res.boom.notFound(`Execution ${executionArn} not found`);
    }
    return res.boom.badRequest(errorify(error));
  }

  if (granule.collectionId !== collectionId) {
    return res.boom.notFound(`No granule found to associate execution with for granuleId ${granuleId} collectionId ${collectionId}`);
  }

  const updatedGranule = {
    ...granule,
    execution: execution.execution,
    updatedAt: Date.now(),
  };

  try {
    await writeGranuleFromApi(updatedGranule, knex);
  } catch (error) {
    log.error(`failed to associate execution ${executionArn} with granule granuleId ${granuleId} collectionId ${collectionId}`, error);
    return res.boom.badRequest(errorify(error));
  }
  return res.send({
    message: `Successfully associated execution ${executionArn} with granule granuleId ${granuleId} collectionId ${collectionId}`,
  });
};

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
  const { getRecoveryStatus } = req.query;
  const granuleId = req.params.granuleName;
  let result;
  try {
    result = await (new models.Granule()).get({ granuleId });
  } catch (error) {
    if (error.message.startsWith('No record found')) {
      return res.boom.notFound('Granule not found');
    }

    throw error;
  }

  const recoveryStatus = getRecoveryStatus === 'true'
    ? await getOrcaRecoveryStatusByGranuleId(granuleId)
    : undefined;
  return res.send({ ...result, recoveryStatus });
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
router.post('/:granuleName/executions', associateExecution);
router.post('/', create);
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
