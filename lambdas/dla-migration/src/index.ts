'use strict';

//@ts-check

import get from 'lodash/get';
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

const logger = new Logger({ sender: '@cumulus/dla-migration-lambda' });

/**
 * Manipulate target filepath to put file is YYYY-MM-DD sub-folder
 *
 * @param filePath - filePath to be massaged with date identifier
 * @param message - DLARecord message from which timestamp can be extracted
 * @returns targetPath with lowest 'folder' added in form YYYY-MM-DD
 */
const addDateIdentifierToPath = (filePath: string, message: DLARecord): string => (
  path.join(
    path.dirname(filePath),
    extractDateString(message),
    path.basename(filePath)
  )
);

/**
 * pull S3 Object from sourcePath, update it to new DLA structure and push it to targetPath
 * noop if skip is true and an object already exists at targetPath
 *
 * @param bucket - bucket to operate within
 * @param sourcePath - path to source object
 * @returns whether the update succeeded or not
 */
export const updateDLAFile = async (
  bucket: string,
  sourcePath: string
): Promise<boolean> => {
  try {
    logger.info(`About to process ${sourcePath}`);
    const dlaObject = await getJsonS3Object(bucket, sourcePath);
    const hoisted = await hoistCumulusMessageDetails(dlaObject);
    const massagedTargetPath = addDateIdentifierToPath(sourcePath, hoisted);

    await putJsonS3Object(bucket, massagedTargetPath, hoisted);
    logger.info(`Migrated file from bucket ${bucket}/${sourcePath} to ${massagedTargetPath}`);

    await deleteS3Object(bucket, sourcePath);
    logger.info(`Deleted file ${bucket}/${sourcePath}`);
    return true;
  } catch (error) {
    logger.error(`failed to process ${sourcePath} due to error: ${error}`);
    return false;
  }
};

/**
 * update a batch of DLA files under prefix and push them to the targetDirectory
 * skip files that appear to already have been processed if skip is set to true
 *
 * @param bucket - bucket to operate within
 * @param directory - s3 'directory' within which to process DLA files
 * @param skip - skip files that are already present at the target directory, default false
 */
export const updateDLABatch = async (
  bucket: string,
  directory: string
): Promise<Array<boolean>> => {
  const out = [];
  const sourceDir = directory.endsWith('/') ? directory : `${directory}/`;
  const lastIndexOfDlaPathSeparator = sourceDir.length - 1;
  for await (
    const objectBatch of listS3ObjectsV2Batch({ Bucket: bucket, Prefix: sourceDir })
  ) {
    const keys = objectBatch.map((obj) => obj.Key).filter(
      (key) => key.lastIndexOf('/') === lastIndexOfDlaPathSeparator && key.endsWith('.json')
    );
    out.push(await pMap(
      keys, (async (key) => updateDLAFile(bucket, key)),
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
}
/**
 * lambda event handler for updating dla to new format
 *
 * @param event - can declare dlaPath to override default `${stackName}/dead-letter-archive/sqs/`
 * @returns number of successful files updated
 */
export const handler = async (event: HandlerEvent): Promise<HandlerOutput> => {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;

  const sourceDirectory = get(event, 'dlaPath', getDLARootKey(stackName));
  const successes = await updateDLABatch(systemBucket, sourceDirectory);
  return { migrated: successes.filter(Boolean).length };
};
