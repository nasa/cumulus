'use strict';

import { Context } from 'aws-lambda';
import pMap from 'p-map';
import { AssertionError } from 'assert';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { constructCollectionId } from '@cumulus/message/Collections';
import { log } from '@cumulus/common';
import { ApiGranuleRecord, ApiFile } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { BucketsConfigObject } from '@cumulus/common/types';
import { bulkPatch, bulkPatchGranuleCollection } from '@cumulus/api-client/granules';
import { getRequiredEnvVar } from '@cumulus/common/env';

import keyBy from 'lodash/keyBy';
import range from 'lodash/range';
import { deleteS3Object } from '@cumulus/aws-client/S3';
import { ValidationError } from '@cumulus/errors/dist';

type ValidApiFile = {
  bucket: string,
  key: string,
  fileName: string,
} & ApiFile;

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
    oldGranules: Array<ApiGranuleRecord>,
  }
}

function validateFile(file: Omit<ApiFile, 'granuleId'>): ValidApiGranuleFile {
  if (!file.key || !file.bucket) {
    throw new ValidationError(`file ${file} must contain key and bucket`);
  }
  if (file.fileName) {
    return file as ValidApiGranuleFile;
  }
  return {
    ...file,
    fileName: file.fileName || file.key.split('/').pop(),
  } as ValidApiGranuleFile;
}

function validateGranule(granule: ApiGranuleRecord): ValidGranuleRecord {
  if (!granule.files) {
    return {
      ...granule,
      files: [],
    } as ValidGranuleRecord;
  }
  return {
    ...granule,
    files: granule.files.map(validateFile),
  } as ValidGranuleRecord;
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

async function cleanupS3File(
  newFile: ValidApiGranuleFile,
  oldFile: ValidApiGranuleFile
): Promise<void> {
  if (
    newFile.bucket === oldFile.bucket &&
    newFile.key === oldFile.key
  ) {
    return;
  }
  if (!(oldFile.bucket && oldFile.key)) {
    return;
  }
  await deleteS3Object(oldFile.bucket, oldFile.key);
}

async function cleanupInS3(
  newGranules: ValidGranuleRecord[],
  oldGranules: { [granuleId: string]: ValidGranuleRecord }
) {
  const operations = newGranules.flatMap((newGranule) => {
    const oldGranule = oldGranules[newGranule.granuleId];
    if (!oldGranule) {
      return [];
    }
    if (!oldGranule.files || !oldGranule.files) {
      return [];
    }
    const oldFilesByName = keyBy(oldGranule.files, 'fileName');
    return newGranule.files.map((newFile) => {
      const oldFile = oldFilesByName[newFile.fileName];
      if (!oldFile) {
        throw new AssertionError({
          message: 'mismatch between target and source granule files',
        });
      }
      return async () => await cleanupS3File(newFile, oldFile);
    });
  });
  pMap(
    operations,
    async (operation) => await operation(),
    { concurrency: Number(process.env.concurrency || 100) }
  );
}

function chunkGranules(granules: ValidGranuleRecord[]) {
  const chunkSize = getConcurrency();
  return range(granules.length / chunkSize).map((i) => granules.slice(
    i * chunkSize,
    (i + 1) * chunkSize
  ));
}

async function changeGranuleCollectionsPG(
  event: MoveGranuleCollectionsEvent
): Promise<Object> {
  const config = event.config;

  const targetGranules = event.input.granules.map(validateGranule);
  const oldGranulesByID: { [granuleId: string]: ValidGranuleRecord } = keyBy(event.input.oldGranules.map(validateGranule), 'granuleId');
  log.debug(`change-granule-collection-pg run with config ${config}`);
  for (const granuleChunk of chunkGranules(targetGranules)) {
    //eslint-disable-next-line no-await-in-loop
    await moveGranulesInCumulusDatastores(
      granuleChunk,
      constructCollectionId(config.collection.name, config.collection.version),
      constructCollectionId(
        config.targetCollection.name,
        config.targetCollection.version
      )
    );
    //eslint-disable-next-line no-await-in-loop
    await cleanupInS3(granuleChunk, oldGranulesByID);
  }

  return {
    granules: targetGranules,
  };
}

/**
 * Lambda handler
 */
async function handler(event: CumulusMessage, context: Context): Promise<Object> {
  return await runCumulusTask(changeGranuleCollectionsPG, event, context);
}

exports.handler = handler;
exports.changeGranuleCollectionsPG = changeGranuleCollectionsPG;
