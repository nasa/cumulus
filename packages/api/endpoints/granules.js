//@ts-check

'use strict';

const { z } = require('zod');
const isError = require('lodash/isError');
const pMap = require('p-map');
const moment = require('moment');
const router = require('express-promise-router')();
const cloneDeep = require('lodash/cloneDeep');
const { v4: uuidv4 } = require('uuid');
const {
  getWorkflowFileKey,
} = require('@cumulus/common/workflows');

const Logger = require('@cumulus/logger');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { GranuleSearch, TableNames } = require('@cumulus/db');

const { ExecutionAlreadyExists } = require('@cumulus/aws-client/StepFunctions');

const {
  CollectionPgModel,
  ExecutionPgModel,
  getGranuleAndCollection,
  getGranuleIdAndCollectionIdFromFile,
  getGranulesByGranuleId,
  getKnexClient,
  getUniqueGranuleByGranuleId,
  GranulePgModel,
  translateApiGranuleToPostgresGranule,
  translatePostgresCollectionToApiCollection,
  translatePostgresGranuleToApiGranule,
  updateBatchGranulesCollection,
} = require('@cumulus/db');
const { sfn } = require('@cumulus/aws-client/services');

const { getJsonS3Object, promiseS3Upload } = require('@cumulus/aws-client/S3');
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
  requireApiVersion,
} = require('../app/middleware');
const { errorify } = require('../lib/utils');
const { returnCustomValidationErrors } = require('../lib/endpoints');
const { moveGranule, getFilesExistingAtLocation } = require('../lib/granules');
const { reingestGranule, applyWorkflow } = require('../lib/ingest');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const {
  addOrcaRecoveryStatus,
  getOrcaRecoveryStatusByGranuleIdAndCollection,
} = require('../lib/orca');
const {
  validateBulkGranulesRequest,
  getFunctionNameFromRequestContext,
} = require('../lib/request');

const { buildPayload } = require('../lib/rulesHelpers');
const schemas = require('../lib/schemas.js');

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('../src/zod-utils').BetterZodError} BetterZodError
 * @typedef {import('knex').Knex} Knex
 */

const log = new Logger({ sender: '@cumulus/api/granules' });

/**
 * 200/201 helper method for .put update/create messages
 *
 * @param {boolean} isNewRecord - Boolean variable representing if the granule is a new record
 * @param {Object} granule   - API Granule being written
 * @param {Object} res        - express response object
 * @returns {Promise<Object>} Promise resolving to an express response object
 */
function _returnPatchGranuleStatus(isNewRecord, granule, res) {
  if (isNewRecord) {
    return res.status(201).send({
      message: `Successfully wrote granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}`,
    });
  }
  return res.status(200).send({
    message: `Successfully updated granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}`,
  });
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
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const { getRecoveryStatus, ...queryStringParameters } = req.query;

  const dbSearch = new GranuleSearch({ queryStringParameters });
  const result = await dbSearch.query();

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
    throw new Error(
      'granule `status` field must be set for a new granule write.  Please add a status field and value to your granule object and retry your request'
    );
  }
  return apiGranule;
};

const getFileGranuleAndCollectionByBucketAndKey = async (req, res) => {
  const { bucket, key } = req.params;
  const { knex = await getKnexClient() } = req.testContext || {};

  // Get file meta from postgres database using getGranuleIdAndCollectionIdFromFile
  const results = await getGranuleIdAndCollectionIdFromFile({
    bucket,
    key,
    knex,
  });

  if (!results) {
    return res.boom.notFound(
      `No existing file found for bucket: ${bucket} and key: ${key}`
    );
  }

  return res.send({
    granuleId: results?.granule_id,
    collectionId: results?.collection_name
      ? constructCollectionId(
        results?.collection_name,
        results?.collection_version
      ) : undefined,
  });
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
    const granulesByGranuleId = await getGranulesByGranuleId(
      knex,
      pgGranule.granule_id
    );
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
    await createGranuleFromApiMethod(
      _setNewGranuleDefaults(granule, true),
      knex
    );
  } catch (error) {
    log.error('Could not write granule', error);
    return res.boom.badRequest(
      JSON.stringify(error, Object.getOwnPropertyNames(error))
    );
  }
  return res.send({
    message: `Successfully wrote granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}`,
  });
};

/**
 * Update existing granule *or* create new granule
 *
 * @param {Object} req - express request object
 * @param {Knex} req.knex - knex instance to use for patching granule
 * @param {Object} req.testContext - test context for client requests
 * @param {Object} req.body - request body for patching a granule
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const patchGranule = async (req, res) => {
  const {
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    updateGranuleFromApiMethod = updateGranuleFromApi,
  } = req.testContext || {};
  const knex = req.knex ?? await getKnexClient();
  let apiGranule = req.body || {};
  let pgCollection;

  if (!apiGranule.collectionId) {
    res.boom.badRequest('Granule update must include a valid CollectionId');
  }

  try {
    pgCollection = await collectionPgModel.get(
      knex,
      deconstructCollectionId(apiGranule.collectionId)
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(
        `granule collectionId ${apiGranule.collectionId} does not exist, cannot update granule`
      );
      res.boom.badRequest(
        `granule collectionId ${apiGranule.collectionId} invalid`
      );
    } else {
      throw error;
    }
  }

  // TODO: CUMULUS-3017 - Remove this unique collectionId condition
  // Check if granuleId exists across another collection
  const granulesByGranuleId = await getGranulesByGranuleId(
    knex,
    apiGranule.granuleId
  );
  const granuleExistsAcrossCollection = granulesByGranuleId.some(
    (g) => g.collection_cumulus_id !== pgCollection.cumulus_id
  );
  if (granuleExistsAcrossCollection) {
    log.error(
      'Could not update or write granule, collectionId is not modifiable.'
    );
    return res.boom.conflict(
      `Modifying collectionId for a granule is not allowed. Write for granuleId: ${apiGranule.granuleId} failed.`
    );
  }

  let isNewRecord = false;
  try {
    await granulePgModel.get(knex, {
      granule_id: apiGranule.granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    }); // TODO this should do a select count, not a full record get
  } catch (error) {
    // Set status to `201 - Created` if record did not originally exist
    if (error instanceof RecordDoesNotExist) {
      isNewRecord = true;
    } else {
      return res.boom.badRequest(errorify(error));
    }
  }

  try {
    if (isNewRecord) {
      apiGranule = _setNewGranuleDefaults(apiGranule, isNewRecord);
    }
    await updateGranuleFromApiMethod(apiGranule, knex);
  } catch (error) {
    log.error('failed to update granule', error);
    return res.boom.badRequest(errorify(error));
  }
  return {
    isNewRecord,
    apiGranule,
    patchRes: res,
  };
};

/**
 * Update existing granule *or* create new granule and return its status
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const patchGranuleAndReturnStatus = async (req, res) => {
  let patchRes;
  let isNewRecord = false;
  let apiGranule = {};
  try {
    ({ isNewRecord, apiGranule, patchRes } = await patchGranule(req, res));
  } catch (error) {
    log.error('failed to update granule', error);
    return res.boom.badRequest(errorify(error));
  }
  return _returnPatchGranuleStatus(isNewRecord, apiGranule, patchRes);
};

/**
 * Helper to check granule and collection IDs in queryparams
 * against the payload body.
 *
 * @param {Object} body - update body payload
 * @param {Object} req - express request object
 * @returns {boolean} true if the body matches the query params
 */
function _granulePayloadMatchesQueryParams(body, req) {
  if (
    body.granuleId === req.params.granuleId
    && body.collectionId === req.params.collectionId
  ) {
    return true;
  }

  return false;
}

/**
 * Replace a single granule
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  let body = req.body;
  if (!body.collectionId) {
    body.collectionId = req.params.collectionId;
  }
  if (!body.granuleId) {
    body.granuleId = req.params.granuleId;
  }
  if (!_granulePayloadMatchesQueryParams(body, req)) {
    return res.boom.badRequest(`inputs :granuleId and :collectionId (${req.params.granuleId} and ${req.params.collectionId}) must match body's granuleId and collectionId (${req.body.granuleId} and ${req.body.collectionId})`);
  }
  // Nullify fields not passed in - we want to remove anything not specified by the user
  const nullifiedGranuleTemplate = Object.keys(
    schemas.granule.properties
  ).reduce((acc, cur) => {
    acc[cur] = null;
    return acc;
  }, {});
  delete nullifiedGranuleTemplate.execution; // Execution cannot be deleted
  body = {
    ...nullifiedGranuleTemplate,
    ...body,
  };

  if (body.execution === null) {
    throw new Error(
      'Execution cannot be deleted via the granule interface, only added'
    );
  }
  req.body = body;
  //Then patch new granule with nulls applied
  return await patchGranuleAndReturnStatus(req, res);
}

const _handleUpdateAction = async (
  req,
  res,
  pgGranule,
  pgCollection
) => {
  const {
    knex = await getKnexClient(),
    reingestHandler = reingestGranule,
    updateGranuleStatusToQueuedMethod = updateGranuleStatusToQueued,
    getFilesExistingAtLocationMethod = getFilesExistingAtLocation,
  } = req.testContext || {};

  const body = req.body;
  const action = body.action;

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    collectionPgRecord: pgCollection,
    knexOrTransaction: knex,
  });

  const granuleId = apiGranule.granuleId;

  log.info(`PUT request "action": ${action}`);

  if (action === 'reingest') {
    const apiCollection =
      translatePostgresCollectionToApiCollection(pgCollection);
    let targetExecution;
    try {
      targetExecution = await chooseTargetExecution({
        granuleId,
        executionArn: body.executionArn,
        workflowName: body.workflowName,
      });
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return res.boom.badRequest(`Cannot reingest granule: ${error.message}`);
      }
      throw error;
    }

    if (targetExecution) {
      log.info(
        `targetExecution has been specified for granule (${granuleId}) reingest: ${targetExecution}`
      );
    }

    await reingestHandler({
      apiGranule: {
        ...apiGranule,
        ...(targetExecution && { execution: targetExecution }),
      },
      queueUrl: process.env.backgroundQueueUrl,
      updateGranuleStatusToQueuedMethod,
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
    await updateGranuleStatusToQueued({ apiGranule, knex });
    await applyWorkflow({
      apiGranule,
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
    const filesAtDestination = await getFilesExistingAtLocationMethod(
      apiGranule,
      body.destinations
    );
    log.info(
      `existing files at destination: ${JSON.stringify(filesAtDestination)}`
    );

    if (filesAtDestination.length > 0) {
      const filenames = filesAtDestination.map((file) => file.fileName);
      const message = `Cannot move granule because the following files would be overwritten at the destination location: ${filenames.join(
        ', '
      )}. Delete the existing files or reingest the source files.`;

      return res.boom.conflict(message);
    }

    await moveGranule(
      apiGranule,
      body.destinations,
      process.env.DISTRIBUTION_ENDPOINT
    );

    return res.send({
      granuleId: apiGranule.granuleId,
      action,
      status: 'SUCCESS',
    });
  }
  return res.boom.badRequest(
    'Action is not supported. Choices are "applyWorkflow", "move", "reingest", "removeFromCmr" or specify no "action" to update an existing granule'
  );
};

/**
 * Update a single granule by granuleId only.
 * Supported Actions: reingest, move, applyWorkflow, RemoveFromCMR.
 * If no action is included on the request, the body is assumed to be an
 * existing granule to update, and update is called with the input parameters.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function patchByGranuleId(req, res) {
  const {
    granulePgModel = new GranulePgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};
  const body = req.body;
  const action = body.action;

  if (!action) {
    if (req.body.granuleId === req.params.granuleId) {
      return patchGranuleAndReturnStatus(req, res);
    }
    return res.boom.badRequest(
      `input :granuleId (${req.params.granuleId}) must match body's granuleId (${req.body.granuleId})`
    );
  }

  const pgGranule = await getUniqueGranuleByGranuleId(
    knex,
    req.params.granuleId,
    granulePgModel
  );

  const collectionPgModel = new CollectionPgModel();
  const pgCollection = await collectionPgModel.get(knex, {
    cumulus_id: pgGranule.collection_cumulus_id,
  });

  return await _handleUpdateAction(req, res, pgGranule, pgCollection);
}

/**
 * Update a single granule by granuleId and collectionId.
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
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const body = req.body;
  const action = body.action;
  if (!action) {
    if (_granulePayloadMatchesQueryParams(body, req)) {
      return patchGranuleAndReturnStatus(req, res);
    }
    return res.boom.badRequest(
      `inputs :granuleId and :collectionId (${req.params.granuleId} and ${req.params.collectionId}) must match body's granuleId and collectionId (${req.body.granuleId} and ${req.body.collectionId})`
    );
  }

  const { pgGranule, pgCollection, notFoundError } =
    await getGranuleAndCollection(
      knex,
      collectionPgModel,
      granulePgModel,
      req.params.granuleId,
      req.params.collectionId
    );

  if (notFoundError) {
    return res.boom.notFound(notFoundError);
  }

  return await _handleUpdateAction(req, res, pgGranule, pgCollection);
}

/**
 * associate an execution with a granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object
 */
const associateExecution = async (req, res) => {
  const granuleName = req.params.granuleId;

  const { collectionId, granuleId, executionArn } = req.body || {};
  if (!granuleId || !collectionId || !executionArn) {
    return res.boom.badRequest(
      'Field granuleId, collectionId or executionArn is missing from request body'
    );
  }

  if (granuleName !== granuleId) {
    return res.boom.badRequest(
      `Expected granuleId to be ${granuleName} but found ${granuleId} in payload`
    );
  }

  const {
    executionPgModel = new ExecutionPgModel(),
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  let pgGranule;
  let pgExecution;
  let pgCollection;
  try {
    pgCollection = await collectionPgModel.get(
      knex,
      deconstructCollectionId(collectionId)
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
        return res.boom.notFound(
          `No collection found to associate execution with for collectionId ${collectionId}`
        );
      }
      if (pgGranule === undefined) {
        return res.boom.notFound(
          `No granule found to associate execution with for granuleId ${granuleId} and collectionId: ${collectionId}`
        );
      }
      if (pgExecution === undefined) {
        return res.boom.notFound(
          `No execution found to associate granule with for executionArn ${executionArn}`
        );
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
      executionCumulusId: pgExecution.cumulus_id,
      granulePgModel,
      postgresGranuleRecord: updatedPgGranule,
      knex,
      snsEventType: 'Update',
    });
  } catch (error) {
    log.error(
      `failed to associate execution ${executionArn} with granule granuleId ${granuleId} collectionId ${collectionId}`,
      error
    );
    return res.boom.badRequest(errorify(error));
  }
  return res.send({
    message: `Successfully associated execution ${executionArn} with granule granuleId ${granuleId} collectionId ${collectionId}`,
  });
};

const BulkPatchGranuleCollectionSchema = z.object({
  apiGranules: z.array(z.object({}).catchall(z.any())).nonempty(),
  collectionId: z.string().nonempty(),
}).catchall(z.unknown());

const BulkPatchSchema = z.object({
  apiGranules: z.array(z.object({}).catchall(z.any())).nonempty(),
  dbConcurrency: z.number().positive(),
  dbMaxPool: z.number().positive(),
}).catchall(z.unknown());

const parseBulkPatchGranuleCollectionPayload = zodParser('BulkPatchGranuleCollection payload', BulkPatchGranuleCollectionSchema);
const parseBulkPatchPayload = zodParser('BulkPatchSchema payload', BulkPatchSchema);

/**
 * Update a batch of granules to change collectionId to a new collectionId
 * in PG
 *
 * @param {Object} req - express request object
 * @param {Object} req.testContext - test context for client requests
 * @param {Object} req.body - request body for patching a granule
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function bulkPatchGranuleCollection(req, res) {
  const {
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};
  const body = parseBulkPatchGranuleCollectionPayload(req.body);
  if (isError(body)) {
    return returnCustomValidationErrors(res, body);
  }
  const granules = req.body.apiGranules;
  const granuleIds = granules.map((granule) => granule.granuleId);
  const newCollectionId = req.body.collectionId;
  let collection;

  try {
    collection = await collectionPgModel.get(
      knex,
      deconstructCollectionId(newCollectionId)
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(`Collection ${newCollectionId} does not exist`);
      return res.boom.notFound(`Collection ${newCollectionId} does not exist`);
    }
    return res.boom.badRequest(error.message);
  }

  await updateBatchGranulesCollection(knex, granuleIds, collection.cumulus_id);

  return res.send({
    message: `Successfully wrote granules with Granule Ids: ${granuleIds} to Collection Id: ${newCollectionId}`,
  });
}

/**
 * Update a batch of granules
 *
 * @param {Object} req - express request object
 * @param {Object} req.testContext - test context for client requests
 * @param {Object} req.body - request body for patching a granule
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function bulkPatch(req, res) {
  const {
    mappingFunction = pMap,
    getKnexClientMethod = getKnexClient,
  } = req.testContext || {};
  req.body.dbConcurrency = req.body.dbConcurrency ?? 5;
  req.body.dbMaxPool = req.body.dbMaxPool ?? 20;
  const body = parseBulkPatchPayload(req.body);

  if (isError(body)) {
    return returnCustomValidationErrors(res, body);
  }
  const granules = body.apiGranules;
  const knex = await getKnexClientMethod({
    env: {
      ...process.env,
      dbMaxPool: body.dbMaxPool.toString(),
    },
  });

  await mappingFunction(
    granules,
    (apiGranule) => patchGranule({ body: apiGranule, knex, testContext: {} }, res),
    { concurrency: body.dbConcurrency }
  );

  return res.send({
    message: 'Successfully patched Granules',
  });
}

const bulkArchiveGranulesSchema = z.object({
  batchSize: z.number().positive().optional().default(100),
  expirationDays: z.number().positive().optional().default(365),
});
const parsebulkArchiveGranulesPayload = zodParser('bulkArchiveGranules payload', bulkArchiveGranulesSchema);
async function bulkArchiveGranules(req, res) {
  const {
    getKnexClientMethod = getKnexClient,
  } = req.testContext || {};
  const body = parsebulkArchiveGranulesPayload(req.body);
  if (isError(body)) {
    return returnCustomValidationErrors(res, body);
  }
  const knex = await getKnexClientMethod();
  const expirationDate = moment().subtract(body.expirationDays, 'd').format('YYYY-MM-DD');

  const subQuery = knex(TableNames.granules)
    .select('cumulus_id')
    .whereBetween('updated_at', [
      new Date(0),
      expirationDate,
    ])
    .where('archived', false)
    .limit(body.batchSize);
  const updatedCount = await knex(TableNames.granules)
    .update({ archived: true })
    .whereIn('cumulus_id', subQuery);
  return res.send({ recordsUpdated: updatedCount });
}
/**
 * Delete a granule by granuleId
 *
 * DEPRECATED: use del() instead to delete granules by
 *   granuleId + collectionId
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function delByGranuleId(req, res) {
  const {
    knex = await getKnexClient(),
  } = req.testContext || {};
  const granuleId = req.params.granuleId;
  log.info(`granules.del ${granuleId}`);

  let pgGranule;
  try {
    pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.info('Granule does not exist');
      return res.boom.notFound(`Granule ${granuleId} does not exist or was already deleted`);
    }
    throw error;
  }

  const deletionDetails = await deleteGranuleAndFiles({
    knex,
    pgGranule: pgGranule,
  });

  return res.send({ detail: 'Record deleted', ...deletionDetails });
}

/**
 * Delete a granule by granuleId + collectionId
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    knex = await getKnexClient(),
    collectionPgModel = new CollectionPgModel(),
    granulePgModel = new GranulePgModel(),
  } = req.testContext || {};

  const granuleId = req.params.granuleId;
  const collectionId = req.params.collectionId;

  log.info(
    `granules.del granuleId: ${granuleId}, collectionId: ${collectionId}`
  );

  let pgGranule;
  let pgCollection;
  try {
    pgCollection = await collectionPgModel.get(
      knex,
      deconstructCollectionId(collectionId)
    );

    pgGranule = await granulePgModel.get(knex, {
      granule_id: granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (collectionId && pgCollection === undefined) {
        return res.boom.notFound(
          `No collection found for granuleId ${granuleId} with collectionId ${collectionId}`
        );
      }
    } else {
      throw error;
    }
  }

  const deletionDetails = await deleteGranuleAndFiles({
    knex,
    pgGranule: pgGranule,
  });

  return res.send({ detail: 'Record deleted', ...deletionDetails });
}

const bulkChangeCollectionSchema = z.object({
  sourceCollectionId: z.string().nonempty('sourceCollectionId is required'),
  targetCollectionId: z.string().nonempty('targetCollectionId is required'),
  batchSize: z.number().positive().optional().default(100),
  concurrency: z.number().positive().optional().default(100),
  s3Concurrency: z.number().positive().optional().default(50),
  listGranulesConcurrency: z.number().positive().optional().default(100),
  dbMaxPool: z.number().positive().optional().default(100),
  maxRequestGranules: z.number().positive().optional().default(10000),
  invalidGranuleBehavior: z.enum(['error', 'skip']).default('error'),
  cmrGranuleUrlType: z.enum(['http', 's3', 'both']).default('both'),
  s3MultipartChunkSizeMb: z.number().optional(),
  executionName: z.string().optional(),
});
const parsebulkChangeCollectionPayload = zodParser('bulkChangeCollection payload', bulkChangeCollectionSchema);

/**
 * Bulk move granules to a new collection.
 *
 * @param {object} req - The request object.
 * @param {object} req.body - The request payload.
 * @param {string} req.body.sourceCollectionId - The source collection ID.
 * @param {string} req.body.targetCollectionId - The target collection ID.
 * @param {number} [req.body.batchSize=100] - The batch size for processing granules.
 * @param {number} [req.body.concurrency=100] - The per-file concurrency level for processing
 * granules and granule records in the cumulus api
 * @param {number} [req.body.s3Concurrency=100] - The per-file concurrency level for processing
 * granules and granule records in s3
 * @param {number} [req.body.maxRequestGranules=1000] - the maximum number of granules to send
 * in an api request
 * @param {string} [req.body.invalidGranuleBehavior='error'] - The behavior for invalid granules
 * ('error' or 'skip').
 * @param {number} [req.body.s3MultipartChunkSizeMb] - The S3 multipart chunk size in MB
 * @param {string} [req.body.executionName] - Override to allow specifying an execution 'name'
 * @param {object} req.testContext - The test context object
 * @param {object} res - The response object.
 * @returns {Promise<Object>} The response object with the execution ARN and message.
 */
async function bulkChangeCollection(req, res) {
  const {
    knex = await getKnexClient(),
    sfnMethod = sfn,
    workflow = 'ChangeGranuleCollectionsWorkflow',
  } = req.testContext || {};

  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();

  if (!process.env.system_bucket) {
    return res.boom.badRequest('API is misconfigured, system_bucket must be defined in the env variables');
  }
  if (!process.env.stackName) {
    return res.boom.badRequest('API is misconfigured, stackName must be defined in the env variables');
  }

  const body = parsebulkChangeCollectionPayload(req.body);
  if (isError(body)) {
    return returnCustomValidationErrors(res, body);
  }

  const { name, version } = deconstructCollectionId(body.sourceCollectionId);

  //get collection
  const pgCollection = await collectionPgModel.get(
    knex,
    { name, version }
  );
  const query = granulePgModel.queryBuilderSearch(knex, {
    collection_cumulus_id: pgCollection.cumulus_id,
  });
  query.select('granule_id');
  query.limit(body.batchSize);
  const granules = await query;
  if (granules.length === 0) {
    return res.boom.notFound(
      `No granules found for collection ${body.sourceCollectionId}`
    );
  }

  const executionName = body.executionName || uuidv4();

  let stateMachineArn;
  try {
    const workflowArnObject = await getJsonS3Object(
      process.env.system_bucket,
      getWorkflowFileKey(process.env.stackName, workflow)
    );
    stateMachineArn = workflowArnObject.arn;
  } catch (error) {
    return res.boom.badRequest(
      `Unable to find state machine ARN for workflow ${workflow}`
    );
  }

  // Upload payload to S3 due to size concerns
  const remoteObjectKey = {
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/bulkGranuleMoveRequests/${executionName}.json`,
  };

  await promiseS3Upload({
    params: {
      ...remoteObjectKey,
      Body: JSON.stringify({
        granuleIds: granules.map((granule) => granule.granule_id),
      }),
    },
  });

  const input = await buildPayload({
    workflow,
    cumulus_meta: {
      workflow_start_time: Date.now(),
      execution_name: executionName,
      state_machine: stateMachineArn,
      system_bucket: process.env.system_bucket,
    },
    meta: {
      collection: {
        name,
        version,
      },
      bulkChangeCollection: {
        batchSize: body.batchSize,
        cmrGranuleUrlType: body.cmrGranuleUrlType,
        concurrency: body.concurrency,
        s3Concurrency: body.s3Concurrency,
        dbMaxPool: body.dbMaxPool,
        invalidGranuleBehavior: body.invalidGranuleBehavior,
        s3MultipartChunkSizeMb: body.s3MultipartChunkSizeMb,
        targetCollection: deconstructCollectionId(body.targetCollectionId),
        maxRequestGranules: body.maxRequestGranules,
        listGranulesConcurrency: body.listGranulesConcurrency,
      },
    },
    payload: {},
  });

  input.cumulus_meta = { ...input.template?.cumulus_meta, ...input.cumulus_meta };
  input.meta = { ...input.template?.meta, ...input.meta };
  input.replace = {
    TargetPath: '$.payload',
    ...remoteObjectKey,
  };

  let startExecutionResult;
  try {
    startExecutionResult = await sfnMethod().startExecution({
      stateMachineArn,
      input: JSON.stringify(input),
      name: executionName,
    });
  } catch (error) {
    if (error instanceof ExecutionAlreadyExists) {
      return res.boom.badRequest(`Execution ${executionName} already exists for state machine ${stateMachineArn}`);
    }
    throw error;
  }
  return res.send({
    execution: startExecutionResult.executionArn,
    message: `Successfully submitted bulk granule change collection with ${granules.length} granules`,
  });
}

/**
 * Query a single granule by granuleId + collectionId.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const {
    knex = await getKnexClient(),
    collectionPgModel = new CollectionPgModel(),
    granulePgModel = new GranulePgModel(),
  } = req.testContext || {};
  const { getRecoveryStatus } = req.query;
  const granuleId = req.params.granuleId;
  const collectionId = req.params.collectionId;

  let granule;
  let pgCollection;
  try {
    pgCollection = await collectionPgModel.get(
      knex,
      deconstructCollectionId(collectionId)
    );

    granule = await granulePgModel.get(knex, {
      granule_id: granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (collectionId && pgCollection === undefined) {
        return res.boom.notFound(
          `No collection found for granuleId ${granuleId} with collectionId ${collectionId}`
        );
      }
      if (granule === undefined) {
        return res.boom.notFound('Granule not found');
      }
    }

    throw error;
  }

  // Get related files, execution ARNs, provider, PDR, and collection and format
  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: granule,
    knexOrTransaction: knex,
  });

  const recoveryStatus =
    getRecoveryStatus === 'true'
      ? await getOrcaRecoveryStatusByGranuleIdAndCollection(granuleId, collectionId)
      : undefined;
  return res.send({ ...result, recoveryStatus });
}

/**
 * Query a single granule by granuleId only.
 * DEPRECATED: use get() instead to fetch granules by
 *   granuleId + collectionId
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function getByGranuleId(req, res) {
  const { knex = await getKnexClient() } = req.testContext || {};
  const { getRecoveryStatus } = req.query;
  const granuleId = req.params.granuleId;

  let granule;

  try {
    granule = await getUniqueGranuleByGranuleId(knex, granuleId);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (granule === undefined) {
        return res.boom.notFound('Granule not found');
      }
    }

    throw error;
  }

  // Get related files, execution ARNs, provider, PDR, and collection and format
  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: granule,
    knexOrTransaction: knex,
  });

  const recoveryStatus =
    getRecoveryStatus === 'true'
      ? await getOrcaRecoveryStatusByGranuleIdAndCollection(granuleId, result.collectionId)
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
  } else if (payload.granules) {
    description = `Bulk run ${payload.workflowName} on ${payload.granules.length} granules`;
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
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
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

  log.debug(
    `About to invoke lambda to start async operation ${asyncOperationId}`
  );
  await startAsyncOperation.invokeStartAsyncOperationLambda(
    asyncOperationEvent
  );
  return res.status(202).send({ id: asyncOperationId });
}

const BulkDeletePayloadSchema = z.object({
  forceRemoveFromCmr: z.boolean().optional(),
  concurrency: z.number().int().positive().optional(),
  maxDbConnections: z.number().int().positive().optional(),
  knexDebug: z.boolean().optional(),
}).catchall(z.unknown());

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
    return returnCustomValidationErrors(res, payload);
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
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        KNEX_DEBUG: payload.knexDebug ? 'true' : 'false',
        launchpad_api: process.env.launchpad_api,
        launchpad_certificate: process.env.launchpad_certificate,
        launchpad_passphrase_secret_name:
          process.env.launchpad_passphrase_secret_name,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
      },
    },
  };

  log.debug(
    `About to invoke lambda to start async operation ${asyncOperationId}`
  );
  await startAsyncOperation.invokeStartAsyncOperationLambda(
    asyncOperationEvent
  );
  return res.status(202).send({ id: asyncOperationId });
}

async function bulkReingest(req, res) {
  const payload = req.body;
  const numOfGranules = (payload.query && payload.query.size)
    || (payload.granules && payload.granules.length);
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
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
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

  log.debug(
    `About to invoke lambda to start async operation ${asyncOperationId}`
  );
  await startAsyncOperation.invokeStartAsyncOperationLambda(
    asyncOperationEvent
  );
  return res.status(202).send({ id: asyncOperationId });
}

async function bulkArchiveGranulesAsyncWrapper(req, res) {
  // const payload = req.body;
  // const description `Archival of ${payload.}`
  const asyncOperationId = uuidv4();
  console.log("trying to run lambdaName:", process.env.ArchiveGranules)
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.ArchiveGranules,
    description: 'look at me go!',
    operationType: 'Bulk Granule Reingest',
    payload: {}
  }
  log.debug(
    `About to invoke lambda to start async operation ${asyncOperationId}`
  );
  await startAsyncOperation.invokeStartAsyncOperationLambda(
    asyncOperationEvent
  );
  return res.status(202).send({ id: asyncOperationId });
}

router.patch('/archiveAsync', bulkArchiveGranulesAsyncWrapper);
router.patch('/archive', bulkArchiveGranules);
router.get('/:collectionId/:granuleId', get);
router.get('/files/get_collection_and_granule_id/:bucket/:key', getFileGranuleAndCollectionByBucketAndKey);
router.get('/:granuleId', getByGranuleId);
router.get('/', list);
router.patch('/bulkPatchGranuleCollection', bulkPatchGranuleCollection);
router.patch('/bulkPatch', bulkPatch);
router.patch('/:collectionId/:granuleId', requireApiVersion(2), patch);
router.patch('/:granuleId', requireApiVersion(2), patchByGranuleId);
router.put('/:collectionId/:granuleId', requireApiVersion(2), put);
router.post('/:granuleId/executions', associateExecution);
router.post('/', create);

router.post('/bulkChangeCollection', bulkChangeCollection);
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
router.delete('/:granuleId', delByGranuleId);
router.delete('/:collectionId/:granuleId', del);

module.exports = {
  bulkDelete,
  bulkChangeCollection,
  bulkOperations,
  bulkReingest,
  del,
  create,
  put,
  patch,
  patchGranuleAndReturnStatus,
  bulkPatch,
  bulkPatchGranuleCollection,
  bulkArchiveGranules,
  getFileGranuleAndCollectionByBucketAndKey,
  router,
};
