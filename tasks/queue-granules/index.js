'use strict';

const get = require('lodash/get');
const isNumber = require('lodash/isNumber');
const memoize = require('lodash/memoize');
const pMap = require('p-map');

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const {
  getWorkflowFileKey,
  templateKey,
} = require('@cumulus/common/workflows');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');

const {
  collections: collectionsApi,
  providers: providersApi,
  granules: granulesApi,
} = require('@cumulus/api-client');

async function fetchGranuleProvider(event, providerId) {
  if (!providerId || providerId === event.config.provider.id) {
    return event.config.provider;
  }

  const { body } = await providersApi.getProvider({
    prefix: event.config.stackName,
    providerId,
  });

  return JSON.parse(body);
}

/**
 * Return the collectionId from a Granule if possible, otherwise throw an Error
 *
 * @param {Object} granule - the granule to get the collectionId from
 * @returns {String} the collectionId of the granule if has it in its properties'
 */
function getCollectionIdFromGranule(granule) {
  if (granule.collectionId) {
    return granule.collectionId;
  }
  if (granule.dataType && granule.version) {
    return constructCollectionId(granule.dataType, granule.version);
  }
  throw new Error('Invalid collection information provided, please check task input to make sure collection information is provided');
}

/**
 * Group granules by collection and split into batches then split again on provider
 * The purpose of this iterable is to avoid creating all the group and chunk arrays all
 * at once to save heap space for large event inputs. This is done by using a sequence of
 * generators that yield the chunks of granules one at a time.
 *
 * The *[Symbol.iterator] method loops over the collection looking for groups that have not
 * already been yielded. Once the first granule of an unseen group is located, a new iterator is
 * created that will search from that point in the collection of granules looking for other
 * granules that belong to the same group.
 *
 * Finally a generator version of the _.chunk() function breaks the grouped granules into chunks.
 */
class GroupedGranulesIterable {
  constructor(granules, chunkSize) {
    this._granules = granules;
    this._chunkSize = isNumber(chunkSize) ? chunkSize : 1;
  }

  _groupKeyFromGranule(collectionId, provider) {
    return provider ? `${provider}${collectionId}` : collectionId;
  }

  /**
   * Lodash's chunk is not a generator so instead this is a version of chunk that builds
   * and yields one chunk at a time, limiting the creation of many arrays all at once.
   */
  *_chunk(iterator) {
    let chunk = [];
    let curr = iterator.next();
    while (!curr.done) {
      if (chunk.length >= this._chunkSize) {
        yield chunk;
        chunk = [];
      }
      chunk.push(curr.value);
      curr = iterator.next();
    }
    if (chunk.length > 0) {
      yield chunk;
    }
  }

  /**
   * This generator acts like a filter. It will yield all granules that match the
   * `groupKey` param, starting at the `start` point passed in. The `start` index
   * is an optimization to avoid reiterating through granules that can't possibly
   * be in the same group because _groupedGranules is called the first time a
   * group is seen from the [Symbol.iterator] generator.
   */
  *_groupedGranules(groupKey, start) {
    for (let i = start; i < this._granules.length; i += 1) {
      const granule = this._granules[i];
      const collectionId = getCollectionIdFromGranule(granule);
      const granuleGroup = this._groupKeyFromGranule(collectionId, granule.provider);
      if (granuleGroup === groupKey) {
        yield granule;
      }
    }
  }

  /**
   * [Symbol.iterator] implements the `Iterable` protocol. This generator iterates through
   * all the granules finding unique groups. When a new group is found, it yields all the
   * matching granules through `_groupedGranules` and chunked using `_chunk`.
   */
  *[Symbol.iterator]() {
    const previouslySeen = new Set();
    for (let i = 0; i < this._granules.length; i += 1) {
      const granule = this._granules[i];
      const collectionId = getCollectionIdFromGranule(granule);
      const groupKey = this._groupKeyFromGranule(collectionId, granule.provider);
      if (!previouslySeen.has(groupKey)) {
        previouslySeen.add(groupKey);
        yield {
          collectionId,
          provider: granule.provider,
          chunks: this._chunk(this._groupedGranules(groupKey, i)),
        };
      }
    }
  }
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

  const memoizedFetchProvider = memoize(fetchGranuleProvider, (_, providerId) => providerId);
  const memoizedFetchCollection = memoize(
    collectionsApi.getCollection,
    ({ collectionName, collectionVersion }) => constructCollectionId(
      collectionName,
      collectionVersion
    )
  );
  const arn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine'),
    get(event, 'cumulus_config.execution_name')
  );
  const pMapConcurrency = get(event, 'config.concurrency', 3);

  const messageTemplate = await getJsonS3Object(
    event.config.internalBucket,
    templateKey(event.config.stackName)
  );
  const { arn: granuleIngestWorkflowArn } = await getJsonS3Object(
    event.config.internalBucket,
    getWorkflowFileKey(event.config.stackName, event.config.granuleIngestWorkflow)
  );
  const iterable = new GroupedGranulesIterable(
    granules,
    event.config.preferredQueueBatchSize
  );
  const executionArns = await pMap(
    iterable,
    async ({ provider, collectionId, chunks }) => {
      const { name: collectionName, version: collectionVersion } = deconstructCollectionId(
        collectionId
      );
      const [collection, normalizedProvider] = await Promise.all([
        memoizedFetchCollection({
          prefix: event.config.stackName,
          collectionName,
          collectionVersion,
        }),
        memoizedFetchProvider(event, provider),
      ]);

      return await pMap(
        chunks,
        async (granuleBatchIn) => {
          const createdAt = Date.now();
          const granuleBatch = updateGranuleBatchCreatedAt(granuleBatchIn, createdAt);
          await pMap(
            granuleBatch,
            (queuedGranule) => {
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
            messageTemplate,
            workflow: {
              name: event.config.granuleIngestWorkflow,
              arn: granuleIngestWorkflowArn,
            },
            granules: granuleBatch,
            queueUrl: event.config.queueUrl,
            provider: normalizedProvider,
            collection,
            pdr: event.input.pdr,
            parentExecutionArn: arn,
            executionNamePrefix: event.config.executionNamePrefix,
            additionalCustomMeta: event.config.childWorkflowMeta,
          });
        },
        { concurrency: pMapConcurrency }
      );
    },
    // purposefully serial, the chunks run in parallel.
    { concurrency: 1 }
  );

  return {
    running: executionArns.flat(),
    ...(event.input.pdr ? { pdr: event.input.pdr } : {}),
  };
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
  handler,
  queueGranules,
  updateGranuleBatchCreatedAt,
  GroupedGranulesIterable,
};
