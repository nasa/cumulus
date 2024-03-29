'use strict';

//@ts-check

import get from 'lodash/get';
import zip from 'lodash/zip';
import Logger from '@cumulus/logger';
import path from 'path';
import {
  getJsonS3Object,
  putJsonS3Object,
  listS3ObjectsV2Batch,
  deleteS3Object,
} from '@cumulus/aws-client/S3';
import {
  hoistCumulusMessageDetails,
  extractDateString,
  getDLARootKey,
} from '@cumulus/message/DeadLetterMessage';
import { DLARecord } from '@cumulus/types/api/dead_letters';
import pMap from 'p-map';
import moment from 'moment';
import cryptoRandomString from 'crypto-random-string';

const logger = new Logger({ sender: '@cumulus/dla-migration-lambda' });

/**
 * identifies whether the innermost folder of the filePath appears to be a timestamp
 *
 * @param targetPath
 * @returns whether the innermost folder of the filePath appears to be a timestamp
 */
export const identifyDatedPath = (targetPath: string): boolean => (
  moment(path.basename(path.dirname(targetPath)), 'YYYY-MM-DD', true).isValid()
);

/**
 * Manipulate target filepath to put file is YYYY-MM-DD sub-folder
 *
 * @param targetPath
 * @param message - DLARecord message from which timestamp can be extracted
 * @returns targetPath with lowest 'folder' added in form YYYY-MM-DD
 */
export const addDateIdentifierToPath = (targetPath: string, message: DLARecord): string => (
  path.join(
    path.dirname(targetPath),
    extractDateString(message),
    path.basename(targetPath)
  )
);

export const addRunID = (key: string, runID: string): string => {
  const regex = new RegExp(`mid.{${runID.length}}\.json`);
  if (key.match(regex)) {
    return key.replace(regex, `mid{${runID}}.json`);
  }
  return key.replace('.json', `mid{${runID}}.json`);
};

/**
 * pull S3 Object from sourcePath, update it to new DLA structure and push it to targetPath
 * noop if skip is true and an object already exists at targetPath
 *
 * @param bucket
 * @param sourcePath
 * @param targetPath
 * @param skip - skip if targetPath already exists
 * @returns whether the logic was actually run (not skipped)
 */
export const updateDLAFile = async (
  bucket: string,
  sourcePath: string,
  runID: string,
): Promise<boolean> => {
  const inDateForm = identifyDatedPath(sourcePath);

  logger.info(`About to process ${sourcePath}`);
  const dlaObject = await getJsonS3Object(bucket, sourcePath);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  let massagedTargetPath: string;
  if (!inDateForm) {
    massagedTargetPath = addDateIdentifierToPath(sourcePath, hoisted);
  } else {
    massagedTargetPath = sourcePath;
  }
  massagedTargetPath = addRunID(massagedTargetPath, runID);
  await putJsonS3Object(bucket, massagedTargetPath, hoisted);
  logger.info(`Migrated file from bucket ${bucket}/${sourcePath} to ${massagedTargetPath}`);
  if (massagedTargetPath !== sourcePath) {
    await deleteS3Object(bucket, sourcePath);
    logger.info(`Deleted file ${bucket}/${sourcePath}`);
  }
  return true;
};

/**
 * update a batch of DLA files under prefix and push them to the targetDirectory
 * skip files that appear to already have been processed if skip is set to true
 *
 * @param bucket
 * @param targetDirectory
 * @param prefix
 * @param skip - skip files that are already present at the target directory, default false
 */
export const updateDLABatch = async (
  bucket: string,
  sourceDirectory: string,
  runID: string
): Promise<Array<boolean>> => {
  const out = [];
  const sourceDir = sourceDirectory.replace('//?$/', '/');
  for await (
    const objectBatch of listS3ObjectsV2Batch({ Bucket: bucket, Prefix: sourceDir })
  ) {
    const keys = objectBatch.map((obj) => obj.Key).filter((key) => key.endsWith('.json') && !key.endsWith(`${runID}.json`));
    
    out.push(await pMap(
      keys, (async (key) => updateDLAFile(bucket, key, runID)),
      {
        concurrency: 5,
        stopOnError: false,
      }
    ));
  }
  return out.flat();
};

export interface HandlerEvent {
  dlaPath?: string
}

export interface HandlerOutput {
  migrated: number
  runID: string
}

export const handler = async (event: HandlerEvent): Promise<HandlerOutput> => {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;
  const runID = cryptoRandomString({ length: 8 });
  const sourceDirectory = get(event, 'dlaPath', getDLARootKey(stackName));
  const successes = await updateDLABatch(systemBucket, sourceDirectory, runID);
  return { runID, migrated: successes.filter(Boolean).length };
};
