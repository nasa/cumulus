'use strict';

//@ts-check

import get from 'lodash/get';
import zip from 'lodash/zip';
import minimist from 'minimist';
import path from 'path';
import {
  getJsonS3Object,
  putJsonS3Object,
  listS3ObjectsV2Batch,
  s3ObjectExists,
} from '@cumulus/aws-client/S3';
import {
  hoistCumulusMessageDetails,
  extractDateString,
  getDLARootKey,
} from '@cumulus/message/DeadLetterMessage';
import { DLARecord } from '@cumulus/types/api/dead_letters';
import pMap from 'p-map';
import moment from 'moment';
/**
 * Check for an Env variable and throw if it's not present
 */
export const getEnvironmentVariable = (variable: string): string => {
  if (!process.env[variable]) {
    throw new Error(`Environment variable "${variable}" is not set.`);
  }
  return process.env[variable] as string;
};

/**
 * Ensure that a string has or does not have a trailing slash as appropriate
 * the strings '' and '/' are special cases that should return '' always
 * because we're handling 'directories' in S3, expect a user to give '/' and mean 'the whole bucket'
 * @param S3Path a string meant to represent a path within an S3 bucket
 * @param shouldHave should it end with a '/'
 * @returns massaged S3Path
 */
export const manipulateTrailingSlash = (S3Path: string, shouldHave: boolean): string => {
  if (S3Path === '' || S3Path === '/') {
    return '';
  }
  const has = S3Path.endsWith('/');
  if (has && shouldHave) {
    return S3Path;
  }
  if (!has && !shouldHave) {
    return S3Path;
  }
  if (!has && shouldHave) {
    return `${S3Path}/`;
  }
  if (has && !shouldHave) {
    let out = S3Path.slice(0, -1);
    while (out.endsWith('/')) {
      out = out.slice(0, -1);
    }
    return out;
  }
  /* this is just to satisfy typescript, it shouldn't be possible to get here */
  return S3Path;
};

/**
 * identifies whether the innermost folder of the filePath appears to be a timestamp
 *
 * @param targetPath
 * @returns whether the innermost folder of the filePath appears to be a timestamp
 */
export const identifyDatedPath = (targetPath: string): boolean => (
  moment(path.basename(path.dirname(targetPath)), 'YYYY-MM-DD').isValid()
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
  targetPath: string,
  skip: boolean = false
): Promise<boolean> => {
  const inDateForm = identifyDatedPath(targetPath);
  // let massagedTargetPath;
  /* *only* if path is already in dateForm, and skip is set we might exit without downloading */
  if (inDateForm && skip && await s3ObjectExists({ Bucket: bucket, Key: targetPath })) {
    return false;
  }
  const dlaObject = await getJsonS3Object(bucket, sourcePath);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  let massagedTargetPath: string;
  if (!inDateForm) {
    massagedTargetPath = addDateIdentifierToPath(targetPath, hoisted);
  } else {
    massagedTargetPath = targetPath;
  }
  /* if we can skip, at least avoid uploading an object */
  if (skip && await s3ObjectExists({ Bucket: bucket, Key: massagedTargetPath })) {
    return false;
  }
  await putJsonS3Object(bucket, massagedTargetPath, hoisted);
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
  targetDirectory: string,
  sourceDirectory: string,
  skip: boolean = false
) => {
  const out = [];
  const sourceDir = manipulateTrailingSlash(sourceDirectory, true);
  const targetDir = manipulateTrailingSlash(targetDirectory, true);
  for await (
    const objectBatch of listS3ObjectsV2Batch({ Bucket: bucket, Prefix: sourceDir })
  ) {
    const validKeys = objectBatch.map((obj) => obj.Key);
    const targetPaths = validKeys.map(
      (filePath) => filePath.replace(
        sourceDir,
        targetDir
      )
    );

    const zipped: Array<[string, string]> = zip(validKeys, targetPaths) as Array<[string, string]>;
    out.push(await pMap(
      zipped, (async (pathPair) => updateDLAFile(bucket, pathPair[0], pathPair[1], skip)),
      {
        concurrency: 5,
        stopOnError: false,
      }
    ));
  }
  return out.flat();
};

interface UpdateDLAArgs {
  prefix: string,
  targetPath: string,
  skip: boolean,
}

/**
 * process command line arguments to get prefix, targetPath, skip values
 *
 * @returns { {prefix: string, targetPath: string, skip: boolean} }
 */
export const processArgs = (): UpdateDLAArgs => {
  const args = minimist(
    process.argv,
    {
      string: ['prefix', 'targetPath'],
      alias: {
        p: 'prefix',
        key: 'prefix',
        k: 'prefix',
        path: 'prefix',
        target: 'targetPath',
        'skip-existing': 'skip',
      },
      default: {
        prefix: undefined,
        targetPath: undefined,
        skip: false,
      },
    }
  );
  const prefix = args.prefix || `${getEnvironmentVariable('DEPLOYMENT')}/dead-letter-archive/sqs/`;
  const targetPath = args.targetPath || `${getEnvironmentVariable('DEPLOYMENT')}/updated-dead-letter-archive/sqs/`;
  return {
    prefix,
    targetPath,
    skip: args.skip,
  };
};

if (require.main === module) {
  const systemBucket = getEnvironmentVariable('SYSTEM_BUCKET');
  const {
    targetPath,
    prefix,
    skip,
  } = processArgs();
  updateDLABatch(systemBucket, targetPath, prefix, skip).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}

interface UpdateDLAHandlerEvent {
  internalBucket?: string
  stackName?: string
}

async function handler(event: UpdateDLAHandlerEvent) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');

  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;

  const sourceDirectory = get(event, 'sourceDirectory', getDLARootKey(stackName));
  const targetDirectory = get(event, 'targetDirectory', getDLARootKey(stackName).replace('dead-letter-archive', 'updated-dead-letter-archive'));
  const skip = true;
  updateDLABatch(systemBucket, targetDirectory, sourceDirectory, skip);
}

module.exports = {
  handler,
  getEnvironmentVariable,
  manipulateTrailingSlash,
  identifyDatedPath,
  addDateIdentifierToPath,
  updateDLAFile,
  updateDLABatch,
  processArgs,
};

// const logger = new Logger({ sender: '@cumulus/dla-migration-lambda' });
// export interface HandlerEvent {
//   dlaPath?: string
// }

// export interface HandlerOutput {
//   migrated: number
// }

// export const handler = async (event: HandlerEvent): Promise<HandlerOutput> => {
//   const systemBucket = process.env.system_bucket || '';
//   const stackName = process.env.stackName || '';

//   const dlaPath = event.dlaPath ?? `${stackName}/dead-letter-archive/sqs/`;
//   const lastIndexOfDlaPathSeparator = dlaPath.lastIndexOf('/');

//   let fileCount = 0;
//   const s3ObjectsQueue = new S3ListObjectsV2Queue({
//     Bucket: systemBucket,
//     Prefix: dlaPath,
//   });

//   /* eslint-disable no-await-in-loop */
//   while (await s3ObjectsQueue.peek()) {
//     const s3Object = await s3ObjectsQueue.shift();
//     const s3ObjectKey = s3Object?.Key;

//     logger.info(`About to process ${s3ObjectKey}`);
//     // skip directories and files on subfolder
//     if (s3ObjectKey && s3ObjectKey.endsWith('.json') && s3ObjectKey.lastIndexOf('/') === lastIndexOfDlaPathSeparator) {
//       const deadLetterMessage = await getJsonS3Object(systemBucket, s3ObjectKey);
//       const dateString = moment.utc(deadLetterMessage.time).format('YYYY-MM-DD');
//       const destinationKey = `${dlaPath}${dateString}/${s3ObjectKey.split('/').pop()}`;

//       await putJsonS3Object(
//         systemBucket,
//         destinationKey,
//         deadLetterMessage
//       );
//       logger.info(`Migrated file from bucket ${systemBucket}/${s3ObjectKey} to ${destinationKey}`);

//       await deleteS3Object(
//         systemBucket,
//         s3ObjectKey
//       );
//       logger.info(`Deleted file ${systemBucket}/${s3ObjectKey}`);

//       fileCount += 1;
//     }
//   }
//   /* eslint-enable no-await-in-loop */

//   logger.info(`Completed DLA migration, migrated ${fileCount} files`);
//   return { migrated: fileCount };
// };
