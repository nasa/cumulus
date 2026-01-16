//@ts-check

const pMap = require('p-map');

const Logger = require('@cumulus/logger');
const {
  GranulePgModel,
  getKnexClient,
  translatePostgresGranuleToApiGranule,
  getUniqueGranuleByGranuleId,
} = require('@cumulus/db');
const { RecordDoesNotExist } = require('@cumulus/errors');

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
  granuleTranslateMethod = translatePostgresGranuleToApiGranule,
  applyWorkflowHandler = applyWorkflow,
  updateGranulesToQueuedMethod = updateGranuleStatusToQueued,
  knex,
}) {
  return await pMap(
    granules,
    (async (granuleId) => {
      try {
        const pgGranule = await getUniqueGranuleByGranuleId(
          knex,
          granuleId,
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
        return granuleId;
      } catch (error) {
        log.error(`Granule ${granuleId} encountered an error`, error);
        return { granuleId, err: String(error) };
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
 * @param {Object} [payload.query] - Optional parameter of query to send to ES (Cloud Metrics)
 * @param {string} [payload.index] - Optional parameter of ES index to query (Cloud Metrics).
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

  const forceRemoveFromCmr = payload.forceRemoveFromCmr === true;
  const knex = await getKnexClient();

  const results = [];
  for await (
    const granuleBatch of getGranulesForPayload(payload)
  ) {
    log.info(`Processing batch of ${granuleBatch.length} granules, for ${JSON.stringify(granuleBatch)}`);
    const batchResults = await pMap(
      granuleBatch,
      async (granuleId) => {
        let pgGranule;
        const granulePgModel = new GranulePgModel();

        try {
          pgGranule = await getUniqueGranuleByGranuleId(
            knex,
            granuleId,
            granulePgModel
          );

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
          return granuleId;
        } catch (error) {
          if (error instanceof RecordDoesNotExist) {
            log.info(error.message);
            return { granuleId, err: 'RecordDoesNotExist' };
          }
          log.error(`Granule ${granuleId} encountered an error`, error);
          return { granuleId, err: String(error) };
        }
      },
      {
        concurrency,
        stopOnError: false,
      }
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Bulk apply workflow to either a list of granules (IDs) or to a list of responses from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {string} payload.workflowName - name of the workflow that will be applied to each granule.
 * @param {Object} [payload.meta] - Optional meta to add to workflow input
 * @param {string} [payload.queueUrl] - Optional name of queue that will be used to start workflows
 * @param {Object} [payload.query] - Optional parameter of query to send to ES (Cloud Metrics)
 * @param {string} [payload.index] - Optional parameter of ES index to query (Cloud Metrics).
 * Must exist if payload.query exists.
 * @param {Object} [payload.granules] - Optional list of granule unique IDs to bulk operate on
 * e.g. { granuleId: xxx, collectionID: xxx }
 * @param {function} [applyWorkflowHandler] - Optional handler for testing
 * @returns {Promise}
 */
async function bulkGranule(payload, applyWorkflowHandler) {
  const knex = await getKnexClient();
  const { queueUrl, workflowName, meta } = payload;
  const results = [];
  for await (
    const granuleBatch of getGranulesForPayload(payload)
  ) {
    log.info(`Processing batch of ${granuleBatch.length} granules, for ${JSON.stringify(granuleBatch)}`);

    const batchResults = await applyWorkflowToGranules({
      knex,
      granules: granuleBatch,
      meta,
      queueUrl,
      workflowName,
      applyWorkflowHandler,
    });
    results.push(...batchResults);
  }
  return results;
}

async function bulkGranuleReingest(
  payload,
  reingestHandler = reingestGranule
) {
  log.info('Starting bulkGranuleReingest');
  const knex = await getKnexClient();

  const concurrency = payload.concurrency || 10;
  const workflowName = payload.workflowName;
  const results = [];
  for await (
    const granuleBatch of getGranulesForPayload(payload)
  ) {
    log.info(`Processing batch of ${granuleBatch.length} granules, for ${JSON.stringify(granuleBatch)}`);

    const batchResults = await pMap(
      granuleBatch,
      async (granuleId) => {
        const granulePgModel = new GranulePgModel();

        try {
          const pgGranule = await getUniqueGranuleByGranuleId(
            knex,
            granuleId,
            granulePgModel
          );

          const apiGranule = await translatePostgresGranuleToApiGranule({
            granulePgRecord: pgGranule,
            knexOrTransaction: knex,
          });

          const targetExecution = await chooseTargetExecution({
            granuleId,
            workflowName,
          });
          const apiGranuleToReingest = {
            ...apiGranule,
            ...(targetExecution && { execution: targetExecution }),
          };
          await reingestHandler({
            apiGranule: apiGranuleToReingest,
            asyncOperationId: process.env.asyncOperationId,
          });
          return granuleId;
        } catch (error) {
          log.error(`Granule ${granuleId} encountered an error`, error);
          return { granuleId, err: String(error) };
        }
      },
      {
        concurrency,
        stopOnError: false,
      }
    );
    results.push(...batchResults);
  }
  return results;
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
