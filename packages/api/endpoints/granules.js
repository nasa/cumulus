// @ts-check

'use strict';

const { z } = require('zod');
const isError = require('lodash/isError');

const router = require('express-promise-router')();
const cloneDeep = require('lodash/cloneDeep');
const { v4: uuidv4 } = require('uuid');

const Logger = require('@cumulus/logger');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const {
  RecordDoesNotExist,
} = require('@cumulus/errors');

const {
  CollectionPgModel,
  ExecutionPgModel,
  getKnexClient,
  getUniqueGranuleByGranuleId,
  getGranulesByGranuleId,
  GranulePgModel,
  translateApiGranuleToPostgresGranule,
  translatePostgresCollectionToApiCollection,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const ESSearchAfter = require('@cumulus/es-client/esSearchAfter');

const { deleteGranuleAndFiles } = require('../src/lib/granule-delete');
const { zodParser } = require('../src/zod-utils');

const { chooseTargetExecution } = require('../lib/executions');
const startAsyncOperation = require('../lib/startAsyncOperation');
const {
  createGranuleFromApi,
  updateGranuleFromApi,
  updateGranuleStatusToQueued,
  writeGranuleRecordAndPublishSns,
} = require('../lib/writeRecords/write-granules');
const {
  asyncOperationEndpointErrorHandler,
  validateApiVersionCompliance,
} = require('../app/middleware');
const { errorify } = require('../lib/utils');
const Granule = require('../models/granules');
const schemas = require('../models/schemas.js');
const { moveGranule } = require('../lib/granules');
const { reingestGranule, applyWorkflow } = require('../lib/ingest');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const { addOrcaRecoveryStatus, getOrcaRecoveryStatusByGranuleId } = require('../lib/orca');
const {
  getFunctionNameFromRequestContext,
  validateBulkGranulesRequest,
} = require('../lib/request');

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('@cumulus/zod-utils').BetterZodError} BetterZodError
 */

const log = new Logger({ sender: '@cumulus/api/granules' });

/**
* 200/201 helper method for .put update/create messages
* @param {boolean} isNewRecord - Boolean variable representing if the granule is a new record
* @param {boolean} granule   - API Granule being written
* @param {Object} res        - express response object
* @returns {Promise<Object>} Promise resolving to an express response object
*/
function _returnPatchGranuleStatus(isNewRecord, granule, res) {
  if (isNewRecord) {
    return res.status(201).send(
      { message: `Successfully wrote granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}` }
    );
  }
  return res.status(200).send(
    { message: `Successfully updated granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}` }
  );
}

function _createNewGranuleDateValue() {
  return new Date().valueOf();
}

/**
 * List all granules for a given collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const { getRecoveryStatus, ...queryStringParameters } = req.query;

  let es;
  if (queryStringParameters.searchContext) {
    es = new ESSearchAfter(
      { queryStringParameters },
      'granule',
      process.env.ES_INDEX
    );
  } else {
    es = new Search(
      { queryStringParameters },
      'granule',
      process.env.ES_INDEX
    );
  }
  const result = await es.query();
  if (getRecoveryStatus === 'true') {
    return res.send(await addOrcaRecoveryStatus(result));
  }
  return res.send(result);
}

/**
 * Set granule defaults for nullish values
 *
 * @param {Object} incomingApiGranule - granule record to set defaults for
 * @param {boolean} isNewRecord - boolean to set
 * @returns {Object} updated granule
 */
const _setNewGranuleDefaults = (incomingApiGranule, isNewRecord = true) => {
  if (isNewRecord === false) return incomingApiGranule;

  const apiGranule = cloneDeep(incomingApiGranule);

  const updateDate = _createNewGranuleDateValue();
  const newGranuleDefaults = {
    published: false,
    createdAt: updateDate,
    updatedAt: updateDate,
    error: {},
  };
  // Set API defaults only if new record
  Object.keys(newGranuleDefaults).forEach((key) => {
    if (!apiGranule[key]) {
      apiGranule[key] = newGranuleDefaults[key];
    }
  });
  if (!apiGranule.status) {
    throw new Error('granule `status` field must be set for a new granule write.  Please add a status field and value to your granule object and retry your request');
  }
  return apiGranule;
};

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
    esClient = await Search.es(),
    createGranuleFromApiMethod = createGranuleFromApi,
  } = req.testContext || {};

  const granule = req.body || {};

  try {
    const pgGranule = await translateApiGranuleToPostgresGranule({
      dynamoRecord: granule,
      knexOrTransaction: knex,
    });

    // TODO: CUMULUS-3017 - Remove this unique collectionId condition
    //  and only check for granule existence
    // Check if granule already exists across all collections
    const granulesByGranuleId = await getGranulesByGranuleId(knex, pgGranule.granule_id);
    if (granulesByGranuleId.length > 0) {
      log.error('Could not write granule. It already exists.');
      return res.boom.conflict(
        `A granule already exists for granuleId: ${pgGranule.granule_id}`
      );
    }
  } catch (error) {
    return res.boom.badRequest(errorify(error));
  }
  try {
    await createGranuleFromApiMethod(_setNewGranuleDefaults(granule, true), knex, esClient);
  } catch (error) {
    log.error('Could not write granule', error);
    return res.boom.badRequest(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  }
  return res.send({ message: `Successfully wrote granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}` });
};

/**
 * Update existing granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const patchGranule = async (req, res) => {
  const {
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
    updateGranuleFromApiMethod = updateGranuleFromApi,
  } = req.testContext || {};
  let apiGranule = req.body || {};
  let pgCollection;

  if (!apiGranule.collectionId) {
    res.boom.badRequest('Granule update must include a valid CollectionId');
  }

  try {
    pgCollection = await collectionPgModel.get(
      knex, deconstructCollectionId(apiGranule.collectionId)
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(`granule collectionId ${apiGranule.collectionId} does not exist, cannot update granule`);
      res.boom.badRequest(`granule collectionId ${apiGranule.collectionId} invalid`);
    } else {
      throw error;
    }
  }

  // TODO: CUMULUS-3017 - Remove this unique collectionId condition
  // Check if granuleId exists across another collection
  const granulesByGranuleId = await getGranulesByGranuleId(knex, apiGranule.granuleId);
  const granuleExistsAcrossCollection = granulesByGranuleId.some(
    (g) => g.collection_cumulus_id !== pgCollection.cumulus_id
  );
  if (granuleExistsAcrossCollection) {
    log.error('Could not update or write granule, collectionId is not modifiable.');
    return res.boom.conflict(
      `Modifying collectionId for a granule is not allowed. Write for granuleId: ${apiGranule.granuleId} failed.`
    );
  }

  let isNewRecord = false;
  let originalStatus;
  try {
    const originalGranule = await granulePgModel.get(knex, {
      granule_id: apiGranule.granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    });
    originalStatus = originalGranule.status;
  } catch (error) {
    // Set status to `201 - Created` if record did not originally exist
    if (error instanceof RecordDoesNotExist) {
      isNewRecord = true;
    } else {
      return res.boom.badRequest(errorify(error));
    }
  }

  try {
    if (isNewRecord) apiGranule = _setNewGranuleDefaults(apiGranule, isNewRecord);
    await updateGranuleFromApiMethod({ status: originalStatus, ...apiGranule }, knex, esClient);
  } catch (error) {
    log.error('failed to update granule', error);
    return res.boom.badRequest(errorify(error));
  }
  return _returnPatchGranuleStatus(isNewRecord, apiGranule, res);
};

/**
 * Replace a single granule
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  let body = req.body;
  if (req.body.granuleId === req.params.granuleName) {
    // Nullify fields not passed in - we want to remove anything not specified by the user
    const nullifiedGranuleTemplate = Object.keys(schemas.granule.properties).reduce((acc, cur) => {
      acc[cur] = null;
      return acc;
    }, {});
    delete nullifiedGranuleTemplate.execution; // Execution cannot be deleted
    body = ({
      ...nullifiedGranuleTemplate,
      ...body,
    });

    if (body.execution === null) {
      throw new Error('Execution cannot be deleted via the granule interface, only added');
    }
    req.body = body;
    //Then patch new granule with nulls applied
    return await patchGranule(req, res);
  }
  return res.boom.badRequest(
    `input :granuleName (${req.params.granuleName}) must match body's granuleId (${req.body.granuleId})`
  );
}

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
async function patch(req, res) {
  const {
    granuleModel = new Granule(),
    knex = await getKnexClient(),
    granulePgModel = new GranulePgModel(),
    reingestHandler = reingestGranule,
    updateGranuleStatusToQueuedMethod = updateGranuleStatusToQueued,
  } = req.testContext || {};

  const granuleId = req.params.granuleName;
  const body = req.body;
  const action = body.action;

  if (!action) {
    if (req.body.granuleId === req.params.granuleName) {
      return patchGranule(req, res);
    }
    return res.boom.badRequest(
      `input :granuleName (${req.params.granuleName}) must match body's granuleId (${req.body.granuleId})`
    );
  }

  const pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId, granulePgModel);

  const collectionPgModel = new CollectionPgModel();
  const pgCollection = await collectionPgModel.get(
    knex,
    { cumulus_id: pgGranule.collection_cumulus_id }
  );
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    collectionPgRecord: pgCollection,
    knexOrTransaction: knex,
  });

  log.info(`PUT request "action": ${action}`);

  if (action === 'reingest') {
    const apiCollection = translatePostgresCollectionToApiCollection(pgCollection);
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

    await updateGranuleStatusToQueuedMethod({ granule: apiGranule, knex });

    await reingestHandler({
      granule: {
        ...apiGranule,
        ...(targetExecution && { execution: targetExecution }),
      },
      queueUrl: process.env.backgroundQueueUrl,
    });

    const response = {
      action,
      granuleId: apiGranule.granuleId,
      status: 'SUCCESS',
    };

    if (apiCollection.duplicateHandling !== 'replace') {
      response.warning = 'The granule files may be overwritten';
    }
    return res.send(response);
  }

  if (action === 'applyWorkflow') {
    await updateGranuleStatusToQueued({ granule: apiGranule, knex });
    await applyWorkflow({
      granule: apiGranule,
      workflow: body.workflow,
      meta: body.meta,
    });

    return res.send({
      granuleId: apiGranule.granuleId,
      action: `applyWorkflow ${body.workflow}`,
      status: 'SUCCESS',
    });
  }

  if (action === 'removeFromCmr') {
    await unpublishGranule({
      knex,
      pgGranuleRecord: pgGranule,
      pgCollection: pgCollection,
    });

    return res.send({
      granuleId: apiGranule.granuleId,
      action,
      status: 'SUCCESS',
    });
  }

  if (action === 'move') {
    // FUTURE - this should be removed from the granule model
    const filesAtDestination = await granuleModel.getFilesExistingAtLocation(
      apiGranule,
      body.destinations
    );
    log.info(`existing files at destination: ${JSON.stringify(filesAtDestination)}`);

    if (filesAtDestination.length > 0) {
      const filenames = filesAtDestination.map((file) => file.fileName);
      const message = `Cannot move granule because the following files would be overwritten at the destination location: ${filenames.join(', ')}. Delete the existing files or reingest the source files.`;

      return res.boom.conflict(message);
    }

    await moveGranule(
      apiGranule,
      body.destinations,
      process.env.DISTRIBUTION_ENDPOINT,
      granuleModel
    );

    return res.send({
      granuleId: apiGranule.granuleId,
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
    executionPgModel = new ExecutionPgModel(),
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  let pgGranule;
  let pgExecution;
  let pgCollection;
  try {
    pgCollection = await collectionPgModel.get(
      knex, deconstructCollectionId(collectionId)
    );
    pgGranule = await granulePgModel.get(knex, {
      granule_id: granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    });
    pgExecution = await executionPgModel.get(knex, {
      arn: executionArn,
    });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (pgCollection === undefined) {
        return res.boom.notFound(`No collection found to associate execution with for collectionId ${collectionId}`);
      }
      if (pgGranule === undefined) {
        return res.boom.notFound(`No granule found to associate execution with for granuleId ${granuleId} and collectionId: ${collectionId}`);
      }
      if (pgExecution === undefined) {
        return res.boom.notFound(`No execution found to associate granule with for executionArn ${executionArn}`);
      }
      return res.boom.notFound(`Execution ${executionArn} not found`);
    }
    return res.boom.badRequest(errorify(error));
  }

  // Update both granule objects with new execution/updatedAt time
  const updatedPgGranule = {
    ...pgGranule,
    updated_at: new Date(),
  };
  const apiGranuleRecord = {
    ...(await translatePostgresGranuleToApiGranule({
      knexOrTransaction: knex,
      granulePgRecord: updatedPgGranule,
    })),
    execution: pgExecution.url,
  };

  try {
    await writeGranuleRecordAndPublishSns({
      apiGranuleRecord,
      esClient,
      executionCumulusId: pgExecution.cumulus_id,
      granuleModel: new Granule(),
      granulePgModel,
      postgresGranuleRecord: updatedPgGranule,
      knex,
      snsEventType: 'Update',
    });
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
  const {
    granuleModelClient = new Granule(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const granuleId = req.params.granuleName;
  const esGranulesClient = new Search(
    {},
    'granule',
    process.env.ES_INDEX
  );
  log.info(`granules.del ${granuleId}`);

  let dynamoGranule;
  let pgGranule;

  try {
    pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (!(await esGranulesClient.exists(granuleId))) {
        log.info('Granule does not exist in Elasticsearch and PostgreSQL');
        return res.boom.notFound('No record found');
      }
      log.info(`Postgres Granule with ID ${granuleId} does not exist but exists in Elasticsearch. Proceeding with deletion.`);
    } else {
      throw error;
    }
  }

  try {
    dynamoGranule = await granuleModelClient.getRecord({ granuleId });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const deletionDetails = await deleteGranuleAndFiles({
    knex,
    dynamoGranule,
    pgGranule,
    esClient,
  });

  return res.send({ detail: 'Record deleted', ...deletionDetails });
}

/**
 * Query a single granule.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const {
    knex = await getKnexClient(),
  } = req.testContext || {};
  const { getRecoveryStatus } = req.query;
  const granuleId = req.params.granuleName;
  let granule;
  try {
    granule = await getUniqueGranuleByGranuleId(knex, granuleId);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('Granule not found');
    }

    throw error;
  }

  // Get related files, execution ARNs, provider, PDR, and collection and format
  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: granule,
    knexOrTransaction: knex,
  });

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

  let description;
  if (payload.query) {
    description = `Bulk run ${payload.workflowName} on ${payload.query.size} granules`;
  } else if (payload.ids) {
    description = `Bulk run ${payload.workflowName} on ${payload.ids.length} granules`;
  } else {
    description = `Bulk run on ${payload.workflowName}`;
  }

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description,
    operationType: 'Bulk Granules',
    payload: {
      payload,
      type: 'BULK_GRANULE',
      envVars: {
        ES_HOST: process.env.ES_HOST,
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        GranulesTable: process.env.GranulesTable,
        invoke: process.env.invoke,
        KNEX_DEBUG: payload.knexDebug ? 'true' : 'false',
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
  };

  log.debug(`About to invoke lambda to start async operation ${asyncOperationId}`);
  await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
  return res.status(202).send({ id: asyncOperationId });
}

const BulkDeletePayloadSchema = z.object({
  forceRemoveFromCmr: z.boolean().optional(),
  concurrency: z.number().int().positive().optional(),
  maxDbConnections: z.number().int().positive().optional(),
  knexDebug: z.boolean().optional(),
}).catchall(z.unknown());

/**
* @param {Response} res - express response object
* @param {BetterZodError} zodError
* @returns {Express.BoomError} the promise of express response object
*/
function _returnCustomValidationErrors(res, zodError) {
  if (zodError.errors.filter((error) => error.match('forceRemoveFromCmr')).length > 0) {
    return res.boom.badRequest('forceRemoveFromCmr must be a boolean value');
  }
  return res.boom.badRequest('invalid payload', zodError);
}

const parseBulkDeletePayload = zodParser('Bulk delete payload', BulkDeletePayloadSchema);

/**
 * Start an AsyncOperation that will perform a bulk granules delete
 *
 * @param {Request} req - express request object
 * @param {Response} res - express response object
 * @returns {Promise<unknown>} the promise of express response object
 */
async function bulkDelete(req, res) {
  const payload = parseBulkDeletePayload(req.body);
  if (isError(payload)) {
    return _returnCustomValidationErrors(res, payload);
  }

  const concurrency = payload.concurrency || 10;

  const maxDbConnections = payload.maxDbConnections || concurrency;

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description: 'Bulk granule deletion',
    operationType: 'Bulk Granule Delete', // this value is set on an ENUM field, so cannot change
    payload: {
      type: 'BULK_GRANULE_DELETE',
      payload: { ...payload, concurrency, maxDbConnections },
      envVars: {
        cmr_client_id: process.env.cmr_client_id,
        CMR_ENVIRONMENT: process.env.CMR_ENVIRONMENT,
        cmr_oauth_provider: process.env.cmr_oauth_provider,
        cmr_password_secret_name: process.env.cmr_password_secret_name,
        cmr_provider: process.env.cmr_provider,
        cmr_username: process.env.cmr_username,
        ES_HOST: process.env.ES_HOST,
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        GranulesTable: process.env.GranulesTable,
        KNEX_DEBUG: payload.knexDebug ? 'true' : 'false',
        launchpad_api: process.env.launchpad_api,
        launchpad_certificate: process.env.launchpad_certificate,
        launchpad_passphrase_secret_name: process.env.launchpad_passphrase_secret_name,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
  };

  log.debug(`About to invoke lambda to start async operation ${asyncOperationId}`);
  await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
  return res.status(202).send({ id: asyncOperationId });
}

async function bulkReingest(req, res) {
  const payload = req.body;
  const numOfGranules = (payload.query && payload.query.size)
    || (payload.ids && payload.ids.length);
  const description = `Bulk granule reingest run on ${numOfGranules || ''} granules`;

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description,
    operationType: 'Bulk Granule Reingest',
    payload: {
      payload,
      type: 'BULK_GRANULE_REINGEST',
      envVars: {
        ES_HOST: process.env.ES_HOST,
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        GranulesTable: process.env.GranulesTable,
        invoke: process.env.invoke,
        KNEX_DEBUG: payload.knexDebug ? 'true' : 'false',
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
  };

  log.debug(`About to invoke lambda to start async operation ${asyncOperationId}`);
  await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
  return res.status(202).send({ id: asyncOperationId });
}

router.get('/:granuleName', get);
router.get('/', list);
router.post('/:granuleName/executions', associateExecution);
router.post('/', create);
router.put('/:granuleName', validateApiVersionCompliance(2), put);
router.patch('/:granuleName', validateApiVersionCompliance(2), patch);

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

module.exports = {
  bulkDelete,
  bulkOperations,
  bulkReingest,
  create,
  put,
  patch,
  patchGranule,
  router,
};
