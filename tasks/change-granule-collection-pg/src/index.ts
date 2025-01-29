'use strict';

import { Context } from 'aws-lambda';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import get from 'lodash/get';
import { constructCollectionId } from '@cumulus/message/Collections';
import { log } from '@cumulus/common';
import { ApiGranuleRecord, CollectionRecord, DuplicateHandling } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { CollectionFile } from '@cumulus/types';
import { BucketsConfigObject } from '@cumulus/common/types';
// import { s3CopyObject, s3PutObject } from '@cumulus/aws-client/S3';
import { bulkPatch, bulkPatchGranuleCollection, getGranule } from '@cumulus/api-client/granules';
import { getRequiredEnvVar } from '@cumulus/common/env';


interface EventConfig {
  targetCollection: CollectionRecord
  collection: {
    meta: {
      granuleMetadataFileExtension: string,
    },
    url_path?: string,
    files: Array<CollectionFile>,
    duplicateHandling?: DuplicateHandling,
    name: string,
    version: string,
  },
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
  const granuleMetadataFileExtension: string = get(
    config,
    'collection.meta.granuleMetadataFileExtension'
  );

  log.debug(`moveGranules config: s3MultipartChunksizeMb, `
    + `granuleMetadataFileExtension ${granuleMetadataFileExtension}, `);

  const targetGranules = event.input.granules;

  await moveGranulesInCumulusDatastores(
    targetGranules,
    constructCollectionId(config.collection.name, config.collection.version),
    constructCollectionId(
      config.targetCollection.name,
      config.targetCollection.version
    ),
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
