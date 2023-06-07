'use strict';

const get = require('lodash/get');
const groupBy = require('lodash/groupBy');
const chunk = require('lodash/chunk');
const isNumber = require('lodash/isNumber');
const pMap = require('p-map');

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const {
  providers: providersApi,
  granules: granulesApi,
} = require('@cumulus/api-client');
const CollectionConfigStore = require('@cumulus/collection-config-store');

async function fetchGranuleProvider(prefix, providerId) {
  const { body } = await providersApi.getProvider({
    prefix,
    providerId,
  });

  return JSON.parse(body);
}

/**
 * Group granules by collection and split into batches then split again on provider
 *
 * @param {Array<Object>} granules - list of input granules
 * @param {number} batchSize - size of batch of granules to queue
 * @returns {Array<Object>} list of lists of granules: each list contains granules which belong
 *                          to the same collection, and each list's max length is set by batchSize
 */
function groupAndBatchGranules(granules, batchSize) {
  const filteredBatchSize = isNumber(batchSize) ? batchSize : 1;

  if (granules.collectionId === 'undefined' && (granules.dataType === undefined || granules.version === undefined)) {
    throw new Error('Invalid collection, please check task input to make sure collection information is provided');
  }

  const granulesByCollectionMap = groupBy(
    granules,
    (g) => (g.collectionId !== undefined ? g.collectionId
      : (constructCollectionId(g.dataType, g.version)))
  );
  const granulesBatchedByCollection = Object.values(granulesByCollectionMap).reduce(
    (arr, granulesByCollection) => arr.concat(chunk(granulesByCollection, filteredBatchSize)),
    []
  );
  return granulesBatchedByCollection.reduce((arr, granuleBatch) => arr.concat(
    Object.values(groupBy(granuleBatch, 'provider'))
  ), []);
}

/**
* Updates each granule in the 'batch' to the passed in createdAt value if one does not already exist
* @param {Array<Object>} granuleBatch - Array of Cumulus Granule objects
* @param {number} createdAt           - 'Date.now()' to apply to the granules if there is no
*                                     existing createdAt value
* @returns {Array<Object>} updated array of Cumulus Granule objects
*/
function updateGranuleBatchCreatedAt(granuleBatch, createdAt) {
  return granuleBatch.map((granule) => ({
    ...granule,
    createdAt: granule.createdAt ? granule.createdAt : createdAt,
  }));
}

/**
 * See schemas/input.json and schemas/config.json for detailed event description
 *
 * @param {Object} event - Lambda event object
 * @param {Object} testMocks - Object containing mock functions for testing
 * @returns {Promise} - see schemas/output.json for detailed output schema
 *   that is passed to the next task in the workflow
 **/
async function queueGranules(event, testMocks = {}) {
  const granules = event.input.granules || [];
  const updateGranule = testMocks.updateGranuleMock || granulesApi.updateGranule;
  const enqueueGranuleIngestMessageFn
    = testMocks.enqueueGranuleIngestMessageMock || enqueueGranuleIngestMessage;

  const collectionConfigStore = new CollectionConfigStore(
    event.config.internalBucket,
    event.config.stackName
  );

  const arn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine'),
    get(event, 'cumulus_config.execution_name')
  );

  const groupedAndBatchedGranules = groupAndBatchGranules(
    granules,
    event.config.preferredQueueBatchSize
  );

  const pMapConcurrency = get(event, 'config.concurrency', 3);
  const executionArns = await pMap(
    groupedAndBatchedGranules,
    async (granuleBatchIn) => {
      if (granuleBatchIn[0].collectionId === 'undefined' && (granuleBatchIn[0].dataType === undefined || granuleBatchIn[0].version === undefined)) {
        throw new Error('Invalid collection, please check task input to make sure collection information is provided');
      }

      const collectionConfig = await collectionConfigStore.get(
        granuleBatchIn[0].dataType,
        granuleBatchIn[0].version
      );

      const createdAt = Date.now();
      const granuleBatch = updateGranuleBatchCreatedAt(granuleBatchIn, createdAt);
      await pMap(
        granuleBatch,
        (queuedGranule) => {
          if (queuedGranule.collectionId === 'undefined' && (queuedGranule.dataType === undefined || queuedGranule.version === undefined)) {
            throw new Error('Invalid collection, please check task input to make sure collection information is provided');
          }

          const collectionId = constructCollectionId(
            queuedGranule.dataType,
            queuedGranule.version
          );

          const granuleId = queuedGranule.granuleId;

          return updateGranule({
            prefix: event.config.stackName,
            collectionId,
            granuleId,
            body: {
              collectionId,
              granuleId,
              status: 'queued',
              createdAt: queuedGranule.createdAt,
            },
          });
        },
        { concurrency: pMapConcurrency }
      );
      return await enqueueGranuleIngestMessageFn({
        granules: granuleBatch,
        queueUrl: event.config.queueUrl,
        granuleIngestWorkflow: event.config.granuleIngestWorkflow,
        provider: granuleBatch[0].provider
          ? await fetchGranuleProvider(event.config.stackName, granuleBatch[0].provider)
          : event.config.provider,
        collection: collectionConfig,
        pdr: event.input.pdr,
        parentExecutionArn: arn,
        stack: event.config.stackName,
        systemBucket: event.config.internalBucket,
        executionNamePrefix: event.config.executionNamePrefix,
        additionalCustomMeta: event.config.childWorkflowMeta,
      });
    },
    { concurrency: pMapConcurrency }
  );

  const result = { running: executionArns };
  if (event.input.pdr) result.pdr = event.input.pdr;
  return result;
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(
    queueGranules,
    event,
    context
  );
}

module.exports = {
  groupAndBatchGranules,
  handler,
  queueGranules,
  updateGranuleBatchCreatedAt,
};
