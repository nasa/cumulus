'use strict';

import { Context } from 'aws-lambda';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { constructCollectionId } from '@cumulus/message/Collections';
import { log } from '@cumulus/common';
import { ApiGranuleRecord, ApiFile } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { BucketsConfigObject } from '@cumulus/common/types';
import { bulkPatch, bulkPatchGranuleCollection, getGranule } from '@cumulus/api-client/granules';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { keyBy, range } from 'lodash';
import { deleteS3Object } from '@cumulus/aws-client/S3';
import { ValidationError } from '@cumulus/errors/dist';

type ValidApiFile = {
  bucket: string,
  key: string,
  fileName: string,
} & ApiFile

export type ValidApiGranuleFile = Omit<ValidApiFile, 'granuleId'>;
export type ValidGranuleRecord = {
  files: ValidApiGranuleFile[]
} & ApiGranuleRecord;
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

function validateFile(file: Omit<ApiFile, 'granuleId'>): file is ValidApiGranuleFile {
  if (!file.key || !file.bucket) {
    throw new ValidationError(`file ${file} must contain key and bucket`)
  }
  if (file.fileName) {
    return true;
  }
  file.fileName = file.fileName || file.key.split('/').pop();
  return true
}

function validateGranule(granule: ApiGranuleRecord): ValidGranuleRecord {
  if (!granule.files) {
    granule.files = []
    return granule as ValidGranuleRecord;
  }
  granule.files.forEach(validateFile);
  return granule as ValidGranuleRecord;
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

async function cleanupS3File(newFile: ValidApiGranuleFile, oldFile: ValidApiGranuleFile): Promise<void>{
  if (
    newFile.bucket == oldFile.bucket &&
    newFile.key == oldFile.key
  ) {
    return;
  }
  if (!(oldFile.bucket && oldFile.key)) {
    return;
  }
  await deleteS3Object(oldFile.bucket, oldFile.key);
}

async function cleanupInS3(newGranules: ValidGranuleRecord[], oldGranules: ValidGranuleRecord[]) {
  const newGranulesDict = keyBy(newGranules, "granuleId");
  await Promise.all(oldGranules.map((oldGranule) => {
    const newGranule = newGranulesDict[oldGranule.granuleId]
    if (!newGranule) {
      return;
    }
    const newFilesByName = keyBy(newGranule.files, 'fileName');

    return Promise.all(oldGranule.files.map((oldFile) => {
      const newFile = newFilesByName[oldFile.fileName]
      if(!newFile) return;
      return cleanupS3File(newFile, oldFile);
    }))
  }))
}

function chunkGranules(granules: ValidGranuleRecord[]) {
  const chunkSize = getConcurrency()
  return range(granules.length/chunkSize).map((i) =>
    granules.slice(i*chunkSize, (i+1)*chunkSize)
  )
}
async function moveGranules(event: MoveGranuleCollectionsEvent): Promise<Object> {
  const config = event.config;

  const targetGranules = event.input.granules;
  const validatedGranules = targetGranules.map(validateGranule);

  log.debug(`change-granule-collection-pg run with config ${config}`);
  for (const granuleChunk of chunkGranules(validatedGranules)) {
    const oldGranules = await Promise.all(granuleChunk.map((granule) => (
      getGranule({
        prefix: getRequiredEnvVar('stackName'),
        granuleId: granule.granuleId
      })
    )))
    await moveGranulesInCumulusDatastores(
      granuleChunk,
      constructCollectionId(config.collection.name, config.collection.version),
      constructCollectionId(
        config.targetCollection.name,
        config.targetCollection.version
      )
    );
    const validatedOldGranules = oldGranules.map(validateGranule);
    await cleanupInS3(granuleChunk, validatedOldGranules);
  }
  

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
