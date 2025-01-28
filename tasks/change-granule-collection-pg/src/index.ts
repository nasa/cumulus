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

const MB = 1024 * 1024;

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
  s3MultipartChunksizeMb?: number,
  distribution_endpoint: string,
  cmrGranuleUrlType: string,
  invalidBehavior: string,
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
  sourceGranules: Array<ApiGranuleRecord>,
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
      apiGranules: sourceGranules,
      collectionId: targetCollectionId,
      esConcurrency: getConcurrency(),
    },
  });
}

/**
 * Move all files in a collection of granules from staging location to final location,
 * and update granule files to include renamed files if any.
 */
async function moveFilesForAllGranules({
  sourceGranules,
  targetGranules,
  sourceCollectionId,
  targetCollectionId,
}: {
  sourceGranules: Array<ApiGranuleRecord>,
  targetGranules: Array<ApiGranuleRecord>,
  sourceCollectionId: string,
  targetCollectionId: string,
}): Promise<void> {
  // update postgres (or other cumulus datastores if applicable)
  // because postgres might be our source of ground truth in the future, it must be updated *last*
  await moveGranulesInCumulusDatastores(
    sourceGranules,
    targetGranules,
    sourceCollectionId,
    targetCollectionId,
  );
}

async function moveGranules(event: MoveGranuleCollectionsEvent): Promise<Object> {
  const config = event.config;
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : Number(process.env.default_s3_multipart_chunksize_mb);

  const granuleMetadataFileExtension: string = get(
    config,
    'collection.meta.granuleMetadataFileExtension'
  );

  log.debug(`moveGranules config: s3MultipartChunksizeMb: ${s3MultipartChunksizeMb}, `
    + `granuleMetadataFileExtension ${granuleMetadataFileExtension}, `
    + `granuleIds ${event.input.granules}, `
    + `meta ${event.config}`);

  const targetGranules = event.input.granules;
  const sourceGranules = await Promise.all(targetGranules.map(async (granule) => await getGranule({
    prefix: getRequiredEnvVar('stack_name'),
    granuleId: granule.granuleId
  })))

  // const updatedCmrMetadata = updateCMRMetadata()
  // Move files from staging location to final location
  await moveFilesForAllGranules({
    sourceGranules,
    targetGranules,
    sourceCollectionId: constructCollectionId(config.collection.name, config.collection.version),
    targetCollectionId: constructCollectionId(
      config.targetCollection.name,
      config.targetCollection.version
    ),
  });

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
