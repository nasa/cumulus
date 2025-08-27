import { Context } from 'aws-lambda';
import get from 'lodash/get';
import isNumber from 'lodash/isNumber';
import memoize from 'lodash/memoize';
import pMap from 'p-map';

import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { enqueueGranuleIngestMessage } from '@cumulus/ingest/queue';
import {
  getWorkflowFileKey,
  templateKey,
} from '@cumulus/common/workflows';
import { constructCollectionId, deconstructCollectionId } from '@cumulus/message/Collections';
import { buildExecutionArn } from '@cumulus/message/Executions';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { getJsonS3Object } from '@cumulus/aws-client/S3';

import {
  collections as collectionsApi,
  providers as providersApi,
  granules as granulesApi,
} from '@cumulus/api-client';

import { QueueGranulesInput, QueueGranulesConfig, QueueGranulesOutput } from './types';
import GroupAndChunkIterable from './iterable';

interface HandlerEvent {
  input: QueueGranulesInput,
  config: QueueGranulesConfig,
}

type ApiGranule = QueueGranulesInput['granules'][number];

async function fetchGranuleProvider(event: HandlerEvent, providerId: string | undefined) {
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
 * @param granule - the granule to get the collectionId from
 * @returns the collectionId of the granule if has it in its properties'
 */
function getCollectionIdFromGranule(granule: ApiGranule): string {
  if (granule.collectionId) {
    return granule.collectionId;
  }
  if (granule.dataType && granule.version) {
    return constructCollectionId(granule.dataType, granule.version);
  }
  throw new Error(`Invalid collection information provided for granule with granuleId: ${granule.granuleId}, `
    + 'please check task input to make sure collection information is provided');
}

/**
 * Return an Iterable of granules, grouped by collectionId and provider, containing
 * chunks of granules to queue together.
 *
 * @param granules - Granules to group and chunk
 * @param preferredBatchSize - The max chunk size to use when chunking the groups (default 1)
 * @returns Iterable
 */
function createIterable(
  granules: ApiGranule[],
  preferredBatchSize: number | null | undefined
): GroupAndChunkIterable<ApiGranule, { collectionId: string, provider: string | undefined }> {
  return new GroupAndChunkIterable(
    granules,
    (granule) => {
      const collectionId = getCollectionIdFromGranule(granule);
      return { collectionId, provider: granule.provider };
    },
    isNumber(preferredBatchSize) && preferredBatchSize > 0 ? preferredBatchSize : 1
  );
}

interface ApiGranuleWithCreatedAt extends ApiGranule {
  createdAt: number
}

/**
 * Updates each granule in the 'batch' to the passed in createdAt
 * value if one does not already exist
 * @param granuleBatch - Array of Cumulus Granule objects
 * @param createdAt    - 'Date.now()' to apply to the granules if there is
 *                        no existing createdAt value
 * @returns updated array of Cumulus Granule objects
 */
function updateGranuleBatchCreatedAt(
  granuleBatch: ApiGranule[],
  createdAt: number
): ApiGranuleWithCreatedAt[] {
  return granuleBatch.map((granule) => (
    {
      ...granule,
      createdAt: granule.createdAt ?? createdAt,
    }
  ));
}

/**
 * See schemas/input.json and schemas/config.json for detailed event description
 *
 * @param event - Lambda event object
 * @returns see schemas/output.json for detailed output schema
 *   that is passed to the next task in the workflow
 */
async function queueGranules(event: HandlerEvent): Promise<QueueGranulesOutput> {
  const granules = (event.input.granules || []);
  const memoizedFetchProvider = memoize(fetchGranuleProvider, (_, providerId) => providerId);
  const memoizedFetchCollection = memoize(
    collectionsApi.getCollection,
    ({ collectionName, collectionVersion }) => constructCollectionId(
      collectionName,
      collectionVersion
    )
  );
  const parentExecutionArn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine')!,
    get(event, 'cumulus_config.execution_name')!
  )!;
  const pMapConcurrency = get(event, 'config.concurrency', 3);

  const messageTemplate = await getJsonS3Object(
    event.config.internalBucket,
    templateKey(event.config.stackName)
  );
  const { arn: granuleIngestWorkflowArn } = await getJsonS3Object(
    event.config.internalBucket,
    getWorkflowFileKey(event.config.stackName, event.config.granuleIngestWorkflow)
  );

  const executionArns = await pMap(
    createIterable(granules, event.config.preferredQueueBatchSize),
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
          const granuleBatch = updateGranuleBatchCreatedAt(granuleBatchIn, Date.now());
          await pMap(
            granuleBatch,
            (queuedGranule) => {
              const { archived, granuleId, producerGranuleId, updatedAt, createdAt } = queuedGranule;

              if (updatedAt && (!Number.isInteger(updatedAt) || updatedAt < 0)) {
                throw new Error(`Invalid updatedAt value: ${queuedGranule.updatedAt} `
                                + `for granule with granuleId: ${queuedGranule.granuleId}`);
              }
              return granulesApi.updateGranule({
                prefix: event.config.stackName,
                collectionId,
                granuleId,
                body: {
                  collectionId,
                  granuleId,
                  producerGranuleId: producerGranuleId || granuleId,
                  status: 'queued',
                  updatedAt: updatedAt ?? createdAt,
                  createdAt: createdAt,
                  archived: archived || false,
                },
              });
            },
            {
              concurrency: pMapConcurrency,
            }
          );

          return await enqueueGranuleIngestMessage({
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
            parentExecutionArn,
            executionNamePrefix: event.config.executionNamePrefix,
            additionalCustomMeta: event.config.childWorkflowMeta,
          });
        },
        {
          concurrency: pMapConcurrency,
        }
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
 * @param event   - a Cumulus Message
 * @param context - an AWS Lambda context
 * @returns       - Returns output from task
 */
async function handler(
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessage | CumulusRemoteMessage> {
  return await runCumulusTask(
    queueGranules,
    event,
    context
  );
}

export {
  createIterable,
  handler,
  queueGranules,
  updateGranuleBatchCreatedAt,
};
