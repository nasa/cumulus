//@ts-check

'use strict';

const { z } = require('zod');
const isError = require('lodash/isError');

const router = require('express-promise-router')();
const cloneDeep = require('lodash/cloneDeep');
const { v4: uuidv4 } = require('uuid');

const Logger = require('@cumulus/logger');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { GranuleSearch } = require('@cumulus/db');

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
  getGranuleAndCollection,
} = require('@cumulus/db');

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

const schemas = require('../lib/schemas.js');

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('../src/zod-utils').BetterZodError} BetterZodError
 */

const log = new Logger({ sender: '@cumulus/api/granules' });

/**
 * 200/201 helper method for .put update/create messages
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
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const patchGranule = async (req, res) => {
  const {
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
    updateGranuleFromApiMethod = updateGranuleFromApi,
  } = req.testContext || {};
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
  return _returnPatchGranuleStatus(isNewRecord, apiGranule, res);
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
  return await patchGranule(req, res);
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

    await updateGranuleStatusToQueuedMethod({ apiGranule, knex });

    await reingestHandler({
      apiGranule: {
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
      return patchGranule(req, res);
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
      return patchGranule(req, res);
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

router.get('/:granuleId', getByGranuleId);
router.get('/:collectionId/:granuleId', get);
router.get('/', list);
router.post('/:granuleId/executions', associateExecution);
router.post('/', create);
router.patch('/:granuleId', requireApiVersion(2), patchByGranuleId);
router.patch('/:collectionId/:granuleId', requireApiVersion(2), patch);
router.put('/:collectionId/:granuleId', requireApiVersion(2), put);

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
  bulkOperations,
  bulkReingest,
  del,
  create,
  put,
  patch,
  patchGranule,
  router,
};
