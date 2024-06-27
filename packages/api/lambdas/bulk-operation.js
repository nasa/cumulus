//@ts-check

const pMap = require('p-map');

const Logger = require('@cumulus/logger');
const {
  GranulePgModel,
  getKnexClient,
  translatePostgresGranuleToApiGranule,
  getGranuleByUniqueColumns,
  CollectionPgModel,
} = require('@cumulus/db');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { deconstructCollectionId } = require('@cumulus/message/Collections');
const { chooseTargetExecution } = require('../lib/executions');
const { deleteGranuleAndFiles } = require('../src/lib/granule-delete');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const { updateGranuleStatusToQueued } = require('../lib/writeRecords/write-granules');
const { getGranulesForPayload } = require('../lib/granules');
const { reingestGranule, applyWorkflow } = require('../lib/ingest');
const { batchDeleteExecutions } = require('../lib/executions');
const { setEnvVarsForOperation } = require('../lib/utils');

const log = new Logger({ sender: '@cumulus/bulk-operation' });

/**
 *
 * @typedef {import('../lib/ingest').reingestGranule } reingestGranule
 */

async function applyWorkflowToGranules({
  granules,
  workflowName,
  meta,
  queueUrl,
  granulePgModel = new GranulePgModel(),
  collectionPgModel = new CollectionPgModel(),
  granuleTranslateMethod = translatePostgresGranuleToApiGranule,
  applyWorkflowHandler = applyWorkflow,
  updateGranulesToQueuedMethod = updateGranuleStatusToQueued,
  knex,
}) {
  return await pMap(
    granules,
    (async (granule) => {
      try {
        const collection = await collectionPgModel.get(
          knex,
          deconstructCollectionId(granule.collectionId)
        );

        const pgGranule = await getGranuleByUniqueColumns(
          knex,
          granule.granuleId,
          collection.cumulus_id,
          granulePgModel
        );
        const apiGranule = await granuleTranslateMethod({
          granulePgRecord: pgGranule,
          knexOrTransaction: knex,
        });
        await updateGranulesToQueuedMethod({ apiGranule, knex });
        await applyWorkflowHandler({
          apiGranule,
          workflow: workflowName,
          meta,
          queueUrl,
          asyncOperationId: process.env.asyncOperationId,
        });
        return granule.granuleId;
      } catch (error) {
        log.error(`Granule ${granule.granuleId} encountered an error`, error);
        return { granuleId: granule.granuleId, err: error };
      }
    })
  );
}

/**
 * @typedef {(granule: unknown, collectionId: string) => Promise<void>} RemoveGranuleFromCmrFn
 */

/**
 * Bulk delete granules based on either a list of granules (IDs) or the query response from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {boolean} [payload.forceRemoveFromCmr]
 *   Whether published granule should be deleted from CMR before removal
 * @param {number} [payload.maxDbConnections]
 *   Maximum number of postgreSQL DB connections to make available for knex queries
 *   Defaults to `concurrency`
 * @param {number} [payload.concurrency]
 *   granule concurrency for the bulk deletion operation.  Defaults to 10
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.granules] - Optional list of granule unique IDs to bulk operate on
 * e.g. { granuleId: xxx, collectionID: xxx }
 * @param {RemoveGranuleFromCmrFn} [removeGranuleFromCmrFunction] - used for test mocking
 * @param {Function} [unpublishGranuleFunc] - Optional function to delete the
 * granule from CMR. Useful for testing.
 * @returns {Promise}
 *   Must exist if payload.query exists.
 * @returns {Promise<unknown>}
 */
async function bulkGranuleDelete(
  payload,
  removeGranuleFromCmrFunction,
  unpublishGranuleFunc = unpublishGranule
) {
  const concurrency = payload.concurrency || 10;

  const dbPoolMax = payload.maxDbConnections || concurrency;
  process.env.dbMaxPool = `${dbPoolMax}`;

  const deletedGranules = [];
  const forceRemoveFromCmr = payload.forceRemoveFromCmr === true;
  const granules = await getGranulesForPayload(payload);
  const knex = await getKnexClient();

  await pMap(
    granules,
    async (granule) => {
      let pgGranule;
      const granulePgModel = new GranulePgModel();
      const collectionPgModel = new CollectionPgModel();

      const collection = await collectionPgModel.get(
        knex,
        deconstructCollectionId(granule.collectionId)
      );

      try {
        pgGranule = await getGranuleByUniqueColumns(
          knex,
          granule.granuleId,
          collection.cumulus_id,
          granulePgModel
        );
      } catch (error) {
        // PG Granule being undefined will be caught by deleteGranulesAndFiles
        if (error instanceof RecordDoesNotExist) {
          log.info(error.message);
        }
        return;
      }

      if (pgGranule.published && forceRemoveFromCmr) {
        ({ pgGranule } = await unpublishGranuleFunc({
          knex,
          pgGranuleRecord: pgGranule,
          removeGranuleFromCmrFunction,
        }));
      }

      await deleteGranuleAndFiles({
        knex,
        pgGranule,
      });

      deletedGranules.push(granule.granuleId);
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
 * @param {Object} [payload.granules] - Optional list of granule unique IDs to bulk operate on
 * e.g. { granuleId: xxx, collectionID: xxx }
 * @param {function} [applyWorkflowHandler] - Optional handler for testing
 * @returns {Promise}
 */
async function bulkGranule(payload, applyWorkflowHandler) {
  const knex = await getKnexClient();
  const { queueUrl, workflowName, meta } = payload;
  const granules = await getGranulesForPayload(payload);
  return await applyWorkflowToGranules({
    knex,
    granules,
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
  const granules = await getGranulesForPayload(payload);
  log.info(`Starting bulkGranuleReingest for ${JSON.stringify(granules)}`);
  const knex = await getKnexClient();

  const workflowName = payload.workflowName;
  return await pMap(
    granules,
    async (granule) => {
      const granulePgModel = new GranulePgModel();
      const collectionPgModel = new CollectionPgModel();

      const collection = await collectionPgModel.get(
        knex,
        deconstructCollectionId(granule.collectionId)
      );

      try {
        const pgGranule = await getGranuleByUniqueColumns(
          knex,
          granule.granuleId,
          collection.cumulus_id,
          granulePgModel
        );
        const apiGranule = await translatePostgresGranuleToApiGranule({
          granulePgRecord: pgGranule,
          knexOrTransaction: knex,
        });

        const targetExecution = await chooseTargetExecution({
          granuleId: granule.granuleId,
          workflowName,
        });
        const apiGranuleToReingest = {
          ...apiGranule,
          ...(targetExecution && { execution: targetExecution }),
        };
        await updateGranuleStatusToQueued({ apiGranule: apiGranuleToReingest, knex });
        await reingestHandler({
          apiGranule: apiGranuleToReingest,
          asyncOperationId: process.env.asyncOperationId,
        });
        return granule.granuleId;
      } catch (error) {
        log.error(`Granule ${granule.granuleId} encountered an error`, error);
        return { granuleId: granule.granuleId, err: error };
      }
    },
    {
      concurrency: 10,
      stopOnError: false,
    }
  );
}

/**
 * Handles various bulk operations based on the event type.
 *
 * @param {Object} event - The event object.
 * @param {string} event.type - The type of the bulk operation. This can be one of the following:
 * 'BULK_GRANULE', 'BULK_GRANULE_DELETE', 'BULK_GRANULE_REINGEST', 'BULK_EXECUTION_DELETE'.
 * @param {Object} event.payload - The payload for the bulk operation. The structure of this object
 * depends on the type of the bulk operation.
 * @param {Function} [event.applyWorkflowHandler] - The handler function for applying workflow.
 * This is required if the type is 'BULK_GRANULE'.
 * @param {reingestGranule} [event.reingestHandler] - The handler function for reingesting granules.
 * This is required if the type is 'BULK_GRANULE_REINGEST'.
 * @returns {Promise} A promise that resolves when the bulk operation is complete.
 * @throws {TypeError} Throws a TypeError if the event type does not
 * match any of the known bulk operation types.
 */
async function handler(event) {
  setEnvVarsForOperation(event);
  log.info(`bulkOperation asyncOperationId ${process.env.asyncOperationId} event type ${event.type}, payload: ${JSON.stringify(event.payload)}`);
  if (event.type === 'BULK_GRANULE') {
    return await bulkGranule(event.payload, event.applyWorkflowHandler);
  }
  if (event.type === 'BULK_GRANULE_DELETE') {
    return await bulkGranuleDelete(event.payload);
  }
  if (event.type === 'BULK_GRANULE_REINGEST') {
    return await bulkGranuleReingest(event.payload, event.reingestHandler);
  }
  if (event.type === 'BULK_EXECUTION_DELETE') {
    return await batchDeleteExecutions(event.payload);
  }
  // throw an appropriate error here
  throw new TypeError(`Type ${event.type} could not be matched, no operation attempted.`);
}

module.exports = {
  applyWorkflowToGranules,
  bulkGranuleDelete,
  handler,
};
