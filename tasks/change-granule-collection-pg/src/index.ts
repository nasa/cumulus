'use strict';

import { Context } from 'aws-lambda';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { constructCollectionId } from '@cumulus/message/Collections';
import { log } from '@cumulus/common';
import { ApiGranuleRecord } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { BucketsConfigObject } from '@cumulus/common/types';
import { bulkPatch, bulkPatchGranuleCollection } from '@cumulus/api-client/granules';
import { getRequiredEnvVar } from '@cumulus/common/env';

interface EventConfig {
  targetCollection: {
    name: string,
    version: string,
  }
  collection: {
    name: string,
    version: string,
  }
  buckets: BucketsConfigObject,
}

interface MoveGranuleCollectionsEvent {
  config: EventConfig,
  cumulus_config?: {
    cumulus_context?: {
      forceDuplicateOverwrite?: boolean,
    }
  },
  input: {
    granules: Array<ApiGranuleRecord>,
  }
}

function getConcurrency() {
  return Number(process.env.concurrency || 100);
}

async function moveGranulesInCumulusDatastores(
  targetGranules: Array<ApiGranuleRecord>,
  sourceCollectionId: string,
  targetCollectionId: string
): Promise<void> {
  const updatedBodyGranules = targetGranules.map((targetGranule) => ({
    ...targetGranule,
    collectionId: sourceCollectionId,
  }));

  await bulkPatch({
    prefix: getRequiredEnvVar('stackName'),
    body: {
      apiGranules: updatedBodyGranules,
      dbConcurrency: getConcurrency(),
      dbMaxPool: getConcurrency(),
    },
  });
  await bulkPatchGranuleCollection({
    prefix: getRequiredEnvVar('stackName'),
    body: {
      apiGranules: updatedBodyGranules,
      collectionId: targetCollectionId,
      esConcurrency: getConcurrency(),
    },
  });
}

async function moveGranules(event: MoveGranuleCollectionsEvent): Promise<Object> {
  const config = event.config;

  const targetGranules = event.input.granules;
  log.debug(`change-granule-collection-pg run with config ${config}`);
  await moveGranulesInCumulusDatastores(
    targetGranules,
    constructCollectionId(config.collection.name, config.collection.version),
    constructCollectionId(
      config.targetCollection.name,
      config.targetCollection.version
    )
  );

  return {
    granules: targetGranules,
  };
}

/**
 * Lambda handler
 */
async function handler(event: CumulusMessage, context: Context): Promise<Object> {
  return await runCumulusTask(moveGranules, event, context);
}

exports.handler = handler;
exports.moveGranules = moveGranules;
