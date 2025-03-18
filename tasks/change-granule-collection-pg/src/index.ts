'use strict';

import { Context } from 'aws-lambda';
import pMap from 'p-map';
import path from 'path';
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
import { ValidationError } from '@cumulus/errors';
import pRetry from 'p-retry';

type ValidApiFile = {
  bucket: string,
  key: string,
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
  concurrency: number | undefined,
  dbMaxPool: number | undefined,
}

type ValidEventConfig = {
  concurrency: number,
  dbMaxPool: number
} & EventConfig;

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

function validateFile(file: Omit<ApiFile, 'granuleId'>): file is ValidApiGranuleFile {
  if (!file.key || !file.bucket) {
    throw new ValidationError(`file ${file} must contain key and bucket`);
  }
  return true;
}

function validateGranule(granule: ApiGranuleRecord): granule is ValidGranuleRecord {
  if (!granule.files) {
    return true;
  }
  granule.files.forEach(validateFile);
  return true;
}

function validateConfig(config: EventConfig): ValidEventConfig {
  const newConfig = config;
  newConfig.concurrency = config.concurrency || 100;
  return newConfig as ValidEventConfig;
}

async function moveGranulesInCumulusDatastores(
  targetGranules: Array<ApiGranuleRecord>,
  sourceCollectionId: string,
  targetCollectionId: string,
  config: ValidEventConfig
): Promise<void> {
  const updatedBodyGranules = targetGranules.map((targetGranule) => ({
    ...targetGranule,
    collectionId: sourceCollectionId,
  }));
  await bulkPatch({
    prefix: getRequiredEnvVar('stackName'),
    body: {
      apiGranules: updatedBodyGranules,
      dbConcurrency: config.concurrency,
      dbMaxPool: config.dbMaxPool,
    },
  });
  await bulkPatchGranuleCollection({
    prefix: getRequiredEnvVar('stackName'),
    body: {
      apiGranules: updatedBodyGranules,
      collectionId: targetCollectionId,
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
  await pRetry(
    async () => await deleteS3Object(oldFile.bucket, oldFile.key),
    { retries: 3, minTimeout: 2000, maxTimeout: 2000 }
  );
}

async function cleanupInS3(
  newGranules: ValidGranuleRecord[],
  oldGranules: { [granuleId: string]: ValidGranuleRecord },
  config: ValidEventConfig
) {
  const operations = newGranules.flatMap((newGranule) => {
    const oldGranule = oldGranules[newGranule.granuleId];
    if (!oldGranule) {
      return [];
    }
    if (!oldGranule.files || !oldGranule.files) {
      return [];
    }
    const oldFilesByName = keyBy(oldGranule.files, (file) => path.basename(file.key));
    return newGranule.files.map((newFile) => {
      const fileName = path.basename(newFile.key);
      const oldFile = oldFilesByName[fileName];
      if (!oldFile) {
        throw new AssertionError({
          message: 'mismatch between target and source granule files',
        });
      }
      return async () => await cleanupS3File(newFile, oldFile);
    });
  });
  await pMap(
    operations,
    async (operation) => await operation(),
    { concurrency: config.concurrency }
  );
}

function chunkGranules(granules: ValidGranuleRecord[], concurrency: number) {
  const chunkSize = concurrency;
  return range(granules.length / chunkSize).map((i) => granules.slice(
    i * chunkSize,
    (i + 1) * chunkSize
  ));
}

async function changeGranuleCollectionsPG(
  event: MoveGranuleCollectionsEvent
): Promise<Object> {
  const config = validateConfig(event.config);

  const targetGranules = event.input.granules.filter(validateGranule);
  const oldGranulesByID: { [granuleId: string]: ValidGranuleRecord } = keyBy(event.input.oldGranules.filter(validateGranule), 'granuleId');
  log.debug(`change-granule-collection-pg run with config ${JSON.stringify(config)}`);
  for (const granuleChunk of chunkGranules(targetGranules, config.concurrency)) {
    //eslint-disable-next-line no-await-in-loop
    await moveGranulesInCumulusDatastores(
      granuleChunk,
      constructCollectionId(config.collection.name, config.collection.version),
      constructCollectionId(
        config.targetCollection.name,
        config.targetCollection.version
      ),
      config
    );
    //eslint-disable-next-line no-await-in-loop
    await cleanupInS3(granuleChunk, oldGranulesByID, config);
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
