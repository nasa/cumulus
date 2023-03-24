'use strict';

const path = require('path');

const Lambda = require('@cumulus/aws-client/Lambda');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const {
  getKnexClient,
  GranulePgModel,
} = require('@cumulus/db');

const { deconstructCollectionId } = require('./utils');
const rulesHelpers = require('./rulesHelpers');
const { updateGranuleStatusToQueued } = require('./writeRecords/write-granules');

/**
   * start the re-ingest of a given granule object
   *
   * @param {Object} params
   * @param {Object} params.apiGranule - the granule object
   * @param {Object} params.queueUrl - SQS queue URL to use for sending messages
   * @param {string} [params.asyncOperationId] - specify asyncOperationId origin
   * @param {GranulePgModel} [params.granulePgModel] - Postgres Granule model
   * (optional, for testing)
   * @param {updateGranuleStatusToQueuedMethod} [params.updateGranuleStatusToQueuedMethod]
   *   - method to update granules to queue (optional, for testing)
   * @returns {Promise<undefined>} - undefined
   */
async function reingestGranule({
  apiGranule,
  queueUrl,
  asyncOperationId = undefined,
  granulePgModel = new GranulePgModel(),
  updateGranuleStatusToQueuedMethod = updateGranuleStatusToQueued,
}) {
  const knex = await getKnexClient();
  await updateGranuleStatusToQueuedMethod({
    apiGranule,
    knex,
    granulePgModel,
  });

  const executionArn = path.basename(apiGranule.execution);

  const executionDescription = await StepFunctions.describeExecution({ executionArn });
  const originalMessage = JSON.parse(executionDescription.input);

  const { name, version } = deconstructCollectionId(apiGranule.collectionId);

  const lambdaPayload = await rulesHelpers.buildPayload({
    workflow: originalMessage.meta.workflow_name,
    meta: originalMessage.meta,
    cumulus_meta: {
      cumulus_context: {
        reingestGranule: true,
        forceDuplicateOverwrite: true,
      },
    },
    payload: originalMessage.payload,
    provider: apiGranule.provider,
    collection: {
      name,
      version,
    },
    queueUrl,
    asyncOperationId,
  });

  return Lambda.invoke(process.env.invoke, lambdaPayload);
}

/**
   * apply a workflow to a given granule object
   *
   * @param {Object} params
   * @param {Object} params.apiGranule - the API granule object
   * @param {string} params.workflow - the workflow name
   * @param {Object} [params.meta] - optional meta object to insert in workflow message
   * @param {string} [params.queueUrl] - URL for SQS queue to use for scheduling workflows
   *   e.g. https://sqs.us-east-1.amazonaws.com/12345/queue-name
   * @param {string} [params.asyncOperationId] - specify asyncOperationId origin
   * @returns {Promise<undefined>} undefined
   */
async function applyWorkflow({
  apiGranule,
  workflow,
  meta = undefined,
  queueUrl = undefined,
  asyncOperationId = undefined,
}) {
  if (!workflow) {
    throw new TypeError('applyWorkflow requires a `workflow` parameter');
  }

  const { name, version } = deconstructCollectionId(apiGranule.collectionId);

  const lambdaPayload = await rulesHelpers.buildPayload({
    workflow,
    payload: {
      granules: [apiGranule],
    },
    provider: apiGranule.provider,
    collection: {
      name,
      version,
    },
    meta,
    queueUrl,
    asyncOperationId,
  });

  await Lambda.invoke(process.env.invoke, lambdaPayload);
}

module.exports = {
  reingestGranule,
  applyWorkflow,
};
