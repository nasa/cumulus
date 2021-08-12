const get = require('lodash/get');
const pMap = require('p-map');

const Logger = require('@cumulus/logger');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { CollectionPgModel, GranulePgModel, getKnexClient } = require('@cumulus/db');

const { deconstructCollectionId } = require('../lib/utils');
const { chooseTargetExecution } = require('../lib/executions');
const GranuleModel = require('../models/granules');
const { deleteGranuleAndFiles } = require('../src/lib/granule-delete');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const { getGranuleIdsForPayload } = require('../lib/granules');

const log = new Logger({ sender: '@cumulus/bulk-operation' });

async function applyWorkflowToGranules({
  granuleIds,
  workflowName,
  meta,
  queueUrl,
  granuleModel = new GranuleModel(),
}) {
  const applyWorkflowRequests = granuleIds.map(async (granuleId) => {
    try {
      const granule = await granuleModel.get({ granuleId });
      await granuleModel.applyWorkflow(
        granule,
        workflowName,
        meta,
        queueUrl,
        process.env.asyncOperationId
      );
      return granuleId;
    } catch (error) {
      log.error(`Granule ${granuleId} encountered an error`, error);
      return { granuleId, err: error };
    }
  });
  return await Promise.all(applyWorkflowRequests);
}

/**
 * Fetch a Postgres Granule by granule and collection IDs
 *
 * @param {Knex } knex - DB client
 * @param {string} granuleId - Granule ID
 * @param {string} collectionId - Collection ID in "name___version" format
 * @returns {Promise<PostgresGranuleRecord|undefined>}
 *   The fetched Postgres Granule, if any exists
 * @private
 */
async function _getPgGranuleByCollection(knex, granuleId, collectionId) {
  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();

  let pgGranule;

  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );

    pgGranule = granulePgModel.get(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );
  } catch (error) {
    log.error(error);
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  return pgGranule;
}

// FUTURE: the Dynamo Granule is currently the primary record driving the
// "unpublish from CMR" logic.
// This should be switched to pgGranule once the postgres
// reads are implemented.

/**
 * Bulk delete granules based on either a list of granules (IDs) or the query response from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {boolean} [payload.forceRemoveFromCmr]
 *   Whether published granule should be deleted from CMR before removal
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @param {Function} [unpublishGranuleFunc] - Optional function to delete the
 * granule from CMR. Useful for testing.
 * @returns {Promise}
 */
async function bulkGranuleDelete(
  payload,
  unpublishGranuleFunc = unpublishGranule
) {
  const deletedGranules = [];
  const forceRemoveFromCmr = payload.forceRemoveFromCmr === true;
  const granuleIds = await getGranuleIdsForPayload(payload);
  const granuleModel = new GranuleModel();
  const knex = await getKnexClient({ env: process.env });

  await pMap(
    granuleIds,
    async (granuleId) => {
      let dynamoGranule;
      let pgGranule;

      try {
        dynamoGranule = await granuleModel.getRecord({ granuleId });
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          log.info(`Granule ${granuleId} does not exist or was already deleted, continuing`);
          return;
        }
        throw error;
      }

      if (dynamoGranule && dynamoGranule.published && forceRemoveFromCmr) {
        ({ pgGranule, dynamoGranule } = await unpublishGranuleFunc(knex, dynamoGranule));
      }

      await deleteGranuleAndFiles({
        knex,
        dynamoGranule,
        pgGranule: pgGranule || await _getPgGranuleByCollection(
          knex, granuleId, dynamoGranule.collectionId
        ),
      });

      deletedGranules.push(granuleId);
    },
    {
      concurrency: 10, // is this necessary?
      stopOnError: false,
    }
  );
  return { deletedGranules };
}

/**
 * Bulk apply workflow to either a list of granules (IDs) or to a list of responses from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {string} payload.workflowName - name of the workflow that will be applied to each granule.
 * @param {Object} [payload.meta] - Optional meta to add to workflow input
 * @param {string} [payload.queueUrl] - Optional name of queue that will be used to start workflows
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @returns {Promise}
 */
async function bulkGranule(payload) {
  const { queueUrl, workflowName, meta } = payload;
  const granuleIds = await getGranuleIdsForPayload(payload);
  return await applyWorkflowToGranules({ granuleIds, workflowName, meta, queueUrl });
}

async function bulkGranuleReingest(payload) {
  const granuleIds = await getGranuleIdsForPayload(payload);
  const granuleModel = new GranuleModel();
  const workflowName = payload.workflowName;
  return await pMap(
    granuleIds,
    async (granuleId) => {
      try {
        const granule = await granuleModel.getRecord({ granuleId });
        const targetExecution = await chooseTargetExecution({ granuleId, workflowName });
        await granuleModel.reingest(
          {
            ...granule,
            ...(targetExecution && { execution: targetExecution }),
          },
          process.env.asyncOperationId
        );
        return granuleId;
      } catch (error) {
        log.error(`Granule ${granuleId} encountered an error`, error);
        return { granuleId, err: error };
      }
    },
    {
      concurrency: 10,
      stopOnError: false,
    }
  );
}

function setEnvVarsForOperation(event) {
  const envVars = get(event, 'envVars', {});
  Object.keys(envVars).forEach((envVarKey) => {
    if (!process.env[envVarKey]) {
      process.env[envVarKey] = envVars[envVarKey];
    }
  });
}

async function handler(event) {
  setEnvVarsForOperation(event);
  log.info(`bulkOperation asyncOperationId ${process.env.asyncOperationId} event type ${event.type}`);
  if (event.type === 'BULK_GRANULE') {
    return await bulkGranule(event.payload);
  }
  if (event.type === 'BULK_GRANULE_DELETE') {
    return await bulkGranuleDelete(event.payload);
  }
  if (event.type === 'BULK_GRANULE_REINGEST') {
    return await bulkGranuleReingest(event.payload);
  }
  // throw an appropriate error here
  throw new TypeError(`Type ${event.type} could not be matched, no operation attempted.`);
}

module.exports = {
  applyWorkflowToGranules,
  bulkGranuleDelete,
  handler,
};
