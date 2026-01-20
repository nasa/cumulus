// @ts-nocheck

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
 * @typedef {import('../lib/request').GranuleExecutionPayload} GranuleExecutionPayload
 */

/**
 * Payload for bulk deletion of granules.
 * Extends GranuleExecutionPayload with bulk-delete-specific options.
 *
 * @typedef {GranuleExecutionPayload & {
 *   concurrency?: number,
 *   maxDbConnections?: number,
 *   forceRemoveFromCmr?: boolean
 * }} BulkGranuleDeletePayload
 * @property {number} [concurrency] - Granule concurrency for the bulk operations.
 *   Defaults to 10
 * @property {number} [maxDbConnections] - Maximum number of PostgreSQL connections allocated
 *   to Knex. Defaults to `concurrency`.
 * @property {boolean} [forceRemoveFromCmr] - If true, published granules are deleted from
 *   CMR before local removal.
 */

/**
 * Payload for bulk workflow application to granules.
 * Extends GranuleExecutionPayload with bulk-specific options.
 *
 * @typedef {GranuleExecutionPayload & {
 *   concurrency?: number,
 *   workflowName: string,
 *   meta?: Object,
 *   queueUrl?: string,
 * }} BulkGranulePayload
 * @property {number} [concurrency] - Granule concurrency for the bulk operations. Defaults to 10.
 * @property {string} workflowName - Name of the workflow to apply to each granule.
 * @property {Object} [meta] - Optional meta information to add to workflow input.
 * @property {string} [queueUrl] - Optional queue name used to start workflows.
 */

/**
 * Payload for bulk granule reingest.
 * Extends GranuleExecutionPayload with bulk-specific options.
 *
 * @typedef {GranuleExecutionPayload & {
 *   concurrency?: number,
 *   workflowName: string,
 *   queueUrl?: string,
 * }} BulkGranuleReingestPayload
 * @property {number} [concurrency] - Granule concurrency for the bulk operations. Defaults to 10.
 * @property {string} workflowName - Workflow name that allows different workflow and initial input
 * to be used during reingest.
 * @property {string} [queueUrl] - Optional queue name used to start workflows.
 */

/**
 * Apply a workflow to a batch of granules.
 *
 * @param {Object} params
 * @param {string[]} params.granules - List of granule IDs to process.
 * @param {string} params.workflowName - Name of the workflow to apply to each granule.
 * @param {Object} [params.meta] - Optional metadata to attach to workflow input.
 * @param {string} [params.queueUrl] - Optional queue name used to start workflows.
 * @param {GranulePgModel} [params.granulePgModel=new GranulePgModel()] - postgreSQL granule model
 * @param {Function} [params.granuleTranslateMethod=translatePostgresGranuleToApiGranule]
 *   - Function to translate Postgres granule to API granule format.
 * @param {Function} [params.applyWorkflowHandler=applyWorkflow]
 *   - Function to actually apply the workflow (can be overridden for testing).
 * @param {Function} [params.updateGranulesToQueuedMethod=updateGranuleStatusToQueued]
 *   - Function to update granules to "queued" status after workflow is applied.
 * @param {import('knex').Knex} params.knex - Knex database client instance.
 * @returns {Promise<Array<string | { granuleId: string; error: string }>>}
 *   Results of applying the workflow to each granule.
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
        return { granuleId, error: String(error) };
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
 * @param {BulkGranuleDeletePayload} payload
 * @param {RemoveGranuleFromCmrFn} [removeGranuleFromCmrFunction] - used for test mocking
 * @param {Function} [unpublishGranuleFunc] - Optional function to delete the
 * granule from CMR. Useful for testing.
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
            return { granuleId, error: 'RecordDoesNotExist' };
          }
          log.error(`Granule ${granuleId} encountered an error`, error);
          return { granuleId, error: String(error) };
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
 * @param {BulkGranulePayload} payload
 * @param {Function} [applyWorkflowHandler] - Optional handler for testing
 * @returns {Promise<unknown>}
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

/**
 * Bulk reingest granules based on either a list of granules (IDs) or to a list of responses from
 * ES using the provided query and index.
 *
 * @param {BulkGranuleReingestPayload} payload
 * @param {Function} [reingestHandler] - Optional handler for testing
 * @returns {Promise<unknown>}
 */
async function bulkGranuleReingest(
  payload,
  reingestHandler = reingestGranule
) {
  log.info('Starting bulkGranuleReingest');
  const knex = await getKnexClient();

  const { concurrency = 10, queueUrl, workflowName } = payload;

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
            queueUrl,
            asyncOperationId: process.env.asyncOperationId,
          });
          return granuleId;
        } catch (error) {
          log.error(`Granule ${granuleId} encountered an error`, error);
          return { granuleId, error: String(error) };
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
 * @returns {Promise<unknown>} A promise that resolves when the bulk operation is complete.
 * @throws {TypeError} Throws a TypeError if the event type does not
 * match any of the known bulk operation types.
 */
async function handler(event) {
  setEnvVarsForOperation(event);
  log.info(`bulkOperation asyncOperationId ${process.env.asyncOperationId} event type ${event.type}, payload: ${JSON.stringify(event.payload)}`);
  if (event.type === 'BULK_GRANULE') {
    return await bulkGranule(
      /** @type {BulkGranulePayload} */ (event.payload),
      event.applyWorkflowHandler
    );
  }
  if (event.type === 'BULK_GRANULE_DELETE') {
    /** @type {BulkGranuleDeletePayload} */
    return await bulkGranuleDelete(event.payload);
  }
  if (event.type === 'BULK_GRANULE_REINGEST') {
    return await bulkGranuleReingest(
      /** @type {BulkGranuleReingestPayload} */ (event.payload),
      event.reingestHandler
    );
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
