'use strict';

const path = require('path');

const Lambda = require('@cumulus/aws-client/Lambda');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const {
  getKnexClient,
  GranulePgModel,
  getUniqueGranuleByGranuleId,
} = require('@cumulus/db');

const { deconstructCollectionId } = require('./utils');
const { Granule, Rule } = require('../models');
const { updateGranuleStatusToQueued } = require('./writeRecords/write-granules');

/**
   * Set the Dynamo and PG Granule "status" field to "running"
   *
   * @private
   * @param {Knex} knex - DB client
   * @param {string} granuleId - the granule's ID
   * @param {GranulePgModel} granulePgModel - Postgres Granule model
   * @param {Granule} granuleModel - API Granule model
   * @returns {Promise<undefined>} - undefined
   */
async function _updateGranuleStatus(
  knex,
  granuleId,
  granulePgModel,
  granuleModel
) {
  await granuleModel.updateStatus({ granuleId: granuleId }, 'running');
  const pgGranuleToUpdate = await getUniqueGranuleByGranuleId(
    knex,
    granuleId
  );
  await granulePgModel.upsert(
    knex,
    {
      ...pgGranuleToUpdate,
      status: 'running',
    }
  );
}

/**
   * start the re-ingest of a given granule object
   *
   * @param {Object} params
   * @param {Object} params.reingestParams - the granule object with additional params
   * @param {string} [params.asyncOperationId] - specify asyncOperationId origin
   * @param {Granule} [params.granuleModel] - API Granule model (optional, for testing)
   * @param {GranulePgModel} [params.granulePgModel] - Postgres Granule model
   * (optional, for testing)
   * @returns {Promise<undefined>} - undefined
   */
async function reingestGranule({
  reingestParams,
  asyncOperationId = undefined,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) {
  const knex = await getKnexClient();
  await updateGranuleStatusToQueued({ reingestParams, knex });

  const executionArn = path.basename(reingestParams.execution);

  const executionDescription = await StepFunctions.describeExecution({ executionArn });
  const originalMessage = JSON.parse(executionDescription.input);

  const { name, version } = deconstructCollectionId(reingestParams.collectionId);

  const lambdaPayload = await Rule.buildPayload({
    workflow: originalMessage.meta.workflow_name,
    meta: originalMessage.meta,
    cumulus_meta: {
      cumulus_context: {
        reingestGranule: true,
        forceDuplicateOverwrite: true,
      },
    },
    payload: originalMessage.payload,
    provider: reingestParams.provider,
    collection: {
      name,
      version,
    },
    queueUrl: reingestParams.queueUrl,
    asyncOperationId,
  });

  // FUTURE This would ideally not be necessary
  await _updateGranuleStatus(
    knex,
    reingestParams.granuleId,
    granulePgModel,
    granuleModel
  );

  return Lambda.invoke(process.env.invoke, lambdaPayload);
}

/**
   * apply a workflow to a given granule object
   *
   * @param {Object} params
   * @param {Object} params.granule - the granule object
   * @param {string} params.workflow - the workflow name
   * @param {Object} [params.meta] - optional meta object to insert in workflow message
   * @param {string} [params.queueUrl] - URL for SQS queue to use for scheduling workflows
   *   e.g. https://sqs.us-east-1.amazonaws.com/12345/queue-name
   * @param {string} [params.asyncOperationId] - specify asyncOperationId origin
   * @param {Granule} [params.granuleModel] - API Granule model (optional, for testing)
   * @param {GranulePgModel} [params.granulePgModel] - Postgres Granule model
   * @param {Function} [getPgGranuleHandler] - Optional stub for testing
   * (optional, for testing)
   * @returns {Promise<undefined>} undefined
   */
async function applyWorkflow({
  granule,
  workflow,
  meta = undefined,
  queueUrl = undefined,
  asyncOperationId = undefined,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) {
  if (!workflow) {
    throw new TypeError('applyWorkflow requires a `workflow` parameter');
  }
  const knex = await getKnexClient();

  const { name, version } = deconstructCollectionId(granule.collectionId);

  const lambdaPayload = await Rule.buildPayload({
    workflow,
    payload: {
      granules: [granule],
    },
    provider: granule.provider,
    collection: {
      name,
      version,
    },
    meta,
    queueUrl,
    asyncOperationId,
  });

  // FUTURE This would ideally not be necessary
  await _updateGranuleStatus(
    knex,
    granule.granuleId,
    granulePgModel,
    granuleModel
  );

  await Lambda.invoke(process.env.invoke, lambdaPayload);
}

module.exports = {
  reingestGranule,
  applyWorkflow,
};
