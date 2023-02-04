const get = require('lodash/get');
const pMap = require('p-map');

const Logger = require('@cumulus/logger');
const {
  GranulePgModel,
  getKnexClient,
  getUniqueGranuleByGranuleId,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { chooseTargetExecution } = require('../lib/executions');
const GranuleModel = require('../models/granules');
const { deleteGranuleAndFiles } = require('../src/lib/granule-delete');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const { updateGranuleStatusToQueued } = require('../lib/writeRecords/write-granules');
const { getGranuleIdsForPayload } = require('../lib/granules');
const { reingestGranule, applyWorkflow } = require('../lib/ingest');

const log = new Logger({ sender: '@cumulus/bulk-operation' });

async function applyWorkflowToGranules({
  granuleIds,
  workflowName,
  meta,
  queueUrl,
  granulePgModel = new GranulePgModel(),
  granuleTranslateMethod = translatePostgresGranuleToApiGranule,
  applyWorkflowHandler = applyWorkflow,
  updateGranulesToQueuedMethod = updateGranuleStatusToQueued,
  knex,
}) {
  return await pMap(
    granuleIds,
    (async (granuleId) => {
      try {
        const pgGranule = await getUniqueGranuleByGranuleId(
          knex,
          granuleId,
          granulePgModel
        );
        const granule = await granuleTranslateMethod({
          granulePgRecord: pgGranule,
          knexOrTransaction: knex,
        });
        await updateGranulesToQueuedMethod({ granule, knex });
        await applyWorkflowHandler({
          granule,
          workflow: workflowName,
          meta,
          queueUrl,
          asyncOperationId: process.env.asyncOperationId,
        });
        return granuleId;
      } catch (error) {
        log.error(`Granule ${granuleId} encountered an error`, error);
        return { granuleId, err: error };
      }
    })
  );
}

/**
 * Bulk delete granules based on either a list of granules (IDs) or the query response from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {boolean} [payload.forceRemoveFromCmr]
 *   Whether published granule should be deleted from CMR before removal
 * @param {boolean} [payload.maxDbConnections]
 *   Maximum number of postgreSQL DB connections to make available for knex queries
 *   Defaults to `concurrency`
 * @param {integer} [payload.concurrency]
 *   granule concurrency for the bulk deletion operation.  Defaults to 10
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @param {(granule: any, collectionId: string) => Promise<void>}
 *  [removeGranuleFromCmrFunction] - passed in function used for test mocking
 * @returns {Promise}
 */
async function bulkGranuleDelete(
  payload,
  removeGranuleFromCmrFunction
) {
  const concurrency = payload.concurrency || 10;
  process.env.dbMaxPool = payload.maxDbConnections || concurrency;

  const deletedGranules = [];
  const forceRemoveFromCmr = payload.forceRemoveFromCmr === true;
  const granuleIds = await getGranuleIdsForPayload(payload);
  const knex = await getKnexClient();

  await pMap(
    granuleIds,
    async (granuleId) => {
      let pgGranule;
      let dynamoGranule;
      const granulePgModel = new GranulePgModel();
      const dynamoGranuleModel = new GranuleModel();

      try {
        pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId, granulePgModel);
      } catch (error) {
        // PG Granule being undefined will be caught by deleteGranulesAndFiles
        if (error instanceof RecordDoesNotExist) {
          log.info(error.message);
        }
        return;
      }

      if (pgGranule.published && forceRemoveFromCmr) {
        ({ pgGranule, dynamoGranule } = await unpublishGranule({
          knex,
          pgGranuleRecord: pgGranule,
          removeGranuleFromCmrFunction,
        }));
      } else {
        dynamoGranule = await dynamoGranuleModel.getRecord({ granuleId });
      }

      await deleteGranuleAndFiles({
        knex,
        dynamoGranule,
        pgGranule,
      });
      deletedGranules.push(granuleId);
    },
    {
      concurrency,
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
 * @param {function} [applyWorkflowHandler] - Optional handler for testing
 * @returns {Promise}
 */
async function bulkGranule(payload, applyWorkflowHandler) {
  const knex = await getKnexClient();
  const { queueUrl, workflowName, meta } = payload;
  const granuleIds = await getGranuleIdsForPayload(payload);
  return await applyWorkflowToGranules({
    knex,
    granuleIds,
    meta,
    queueUrl,
    workflowName,
    applyWorkflowHandler,
  });
}

async function bulkGranuleReingest(
  payload,
  reingestHandler = reingestGranule
) {
  const granuleIds = await getGranuleIdsForPayload(payload);
  log.info(`Starting bulkGranuleReingest for ${JSON.stringify(granuleIds)}`);
  const knex = await getKnexClient();

  const workflowName = payload.workflowName;
  return await pMap(
    granuleIds,
    async (granuleId) => {
      try {
        const pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId);
        const granule = await translatePostgresGranuleToApiGranule({
          granulePgRecord: pgGranule,
          knexOrTransaction: knex,
        });

        const targetExecution = await chooseTargetExecution({ granuleId, workflowName });
        const granuleToReingest = {
          ...granule,
          ...(targetExecution && { execution: targetExecution }),
        };
        await updateGranuleStatusToQueued({ granule: granuleToReingest, knex });
        await reingestHandler({
          granule: granuleToReingest,
          asyncOperationId: process.env.asyncOperationId,
        });
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
    return await bulkGranule(event.payload, event.applyWorkflowHandler);
  }
  if (event.type === 'BULK_GRANULE_DELETE') {
    return await bulkGranuleDelete(event.payload);
  }
  if (event.type === 'BULK_GRANULE_REINGEST') {
    return await bulkGranuleReingest(event.payload, event.reingestHandler);
  }
  // throw an appropriate error here
  throw new TypeError(`Type ${event.type} could not be matched, no operation attempted.`);
}

module.exports = {
  applyWorkflowToGranules,
  bulkGranuleDelete,
  handler,
};
