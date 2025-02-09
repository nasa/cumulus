'use strict';

import { Context } from 'aws-lambda';
import get from 'lodash/get';
import keyBy from 'lodash/keyBy';
import cloneDeep from 'lodash/cloneDeep';
import { AssertionError } from 'assert';
import zip from 'lodash/zip';
import flatten from 'lodash/flatten';
import pRetry from 'p-retry';
import path from 'path';
import pMap from 'p-map';

import { InvalidArgument, DuplicateFile } from '@cumulus/errors';
import {
  unversionFilename,
} from '@cumulus/ingest/granule';
import {
  isCMRFile,
  granulesToCmrFileObjects,
  metadataObjectFromCMRFile,
} from '@cumulus/cmrjs';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { s3 } from '@cumulus/aws-client/services';
import { BucketsConfig } from '@cumulus/common';
import { urlPathTemplate } from '@cumulus/ingest/url-path-template';
import { constructCollectionId } from '@cumulus/message/Collections';
import { getCollection } from '@cumulus/api-client/collections';
import { getGranule } from '@cumulus/api-client/granules';
import { CollectionRecord, CollectionFile } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { log } from '@cumulus/common';
import { calculateObjectHash, copyObject, s3Join, s3ObjectExists } from '@cumulus/aws-client/S3';
import { fetchDistributionBucketMap } from '@cumulus/distribution-utils';
import { getCMRCollectionId } from '@cumulus/cmrjs/cmr-utils';
import {
  MB,
  EventConfig,
  ChangeCollectionsS3Event,
  ValidApiFile,
  ValidApiGranuleFile,
  ValidGranuleRecord,
} from './types';
import {
  apiGranuleRecordIsValid,
  CMRObjectToString,
  isCMRMetadataFile,
  updateCmrFileCollections,
  uploadCMRFile,
} from './update_cmr_file_collection';

/**
 * Is this move a "real" move, or is target location identical to source
 */
function objectSourceAndTargetSame(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile
): boolean {
  return !((sourceFile.key === targetFile.key) && (sourceFile.bucket === targetFile.bucket));
}

async function metadataCheckSumsMatch(
  targetFile: ValidApiGranuleFile,
  metadataObject: Object
): Promise<boolean> {
  // const targetString = await getTextObject(targetFile.bucket, targetFile.key);
  const existingGranuleMetadata = await metadataObjectFromCMRFile(
    `s3://${targetFile.bucket}/${targetFile.key}`
  );
  const sourceCollection = getCMRCollectionId(metadataObject, targetFile.key);
  const targetCollection = getCMRCollectionId(existingGranuleMetadata, targetFile.key);
  return sourceCollection === targetCollection;
}

async function checkSumsMatch(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile,
  isMetadata: boolean,
  metadataObject: Object
): Promise<boolean> {
  if (isMetadata) {
    return await metadataCheckSumsMatch(
      targetFile,
      metadataObject
    );
  }
  const [sourceHash, targetHash] = await Promise.all([
    pRetry(
      async () => calculateObjectHash({ s3: s3(), algorithm: 'CKSUM', ...sourceFile }),
      { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
    ),
    pRetry(
      async () => calculateObjectHash({ s3: s3(), algorithm: 'CKSUM', ...targetFile }),
      { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
    ),
  ]);

  return sourceHash === targetHash;
}

/**
 * Identify if a file move is needed.
 * File does not need move *if*
 *   - The target bucket/key is the same as source bucket/key
 *   - The target file is already in its expected location
 * Otherwise it needs to be moved
 * this throws an error if there is a file in the target location but *not* a copy of source
 */
async function s3MoveNeeded(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile,
  isMetadata: boolean,
  metadataObject: Object
): Promise<boolean> {
  // this check is strictly redundant, but allows us to skip some s3 calculations if possible
  if (!objectSourceAndTargetSame(sourceFile, targetFile)) {
    return false;
  }
  const [
    targetExists,
    sourceExists,
  ] = await Promise.all([
    pRetry(
      async () => s3ObjectExists({ Bucket: targetFile.bucket, Key: targetFile.key }),
      { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
    ),
    pRetry(
      async () => s3ObjectExists({ Bucket: sourceFile.bucket, Key: sourceFile.key }),
      { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
    ),
  ]);
  //this is the normal happy path
  if (sourceExists && !targetExists) {
    return true;
  }
  // either this granule is being reprocessed *or* there's a file collision between collections
  if (sourceExists && targetExists) {
    if (await checkSumsMatch(sourceFile, targetFile, isMetadata, metadataObject)) {
      // this file was already moved, but is being reprocessed
      // presumably because of a failure elsewhere in the workflow
      return false;
    }
    throw new DuplicateFile(
      `file Bucket: ${targetFile.bucket}, Key: ${targetFile.key} already exists.` +
      'cannot copy over without deleting existing data'
    );
  }
  log.warn(
    `source location Bucket: ${sourceFile.bucket}, Key: ${sourceFile.key}` +
    "doesn't exist, has this file already been moved?"
  );
  return false;
}

/**
 * Validates the file matched only one collection and has a valid bucket
 * config.
 */
function identifyFileMatch(
  bucketsConfig: BucketsConfig,
  fileName: string,
  fileSpecs: Array<CollectionFile>
): CollectionFile {
  const collectionRegexes = fileSpecs.map((spec) => spec.regex);
  const matches = fileSpecs.filter(
    ((collectionFile) => unversionFilename(fileName).match(collectionFile.regex))
  );
  if (matches.length > 1) {
    throw new InvalidArgument(`File (${fileName}) matched more than one of ${JSON.stringify(collectionRegexes)}.`);
  }
  if (matches.length === 0) {
    throw new InvalidArgument(`File (${fileName}) did not match any of ${JSON.stringify(collectionRegexes)}`);
  }
  const [match] = matches;
  if (!bucketsConfig.keyExists(match.bucket)) {
    throw new InvalidArgument(`Collection config specifies a bucket key of ${match.bucket}, `
      + `but the configured bucket keys are: ${Object.keys(bucketsConfig).join(', ')}`);
  }
  return match;
}

async function copyFileInS3({
  sourceFile,
  targetFile,
  cmrObject,
  s3MultipartChunksizeMb,
}: {
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile,
  cmrObject: Object,
  s3MultipartChunksizeMb?: number,
}): Promise<void> {
  const isMetadata = isCMRMetadataFile(targetFile);
  if (!await s3MoveNeeded(sourceFile, targetFile, isMetadata, cmrObject)) {
    return;
  }
  if (isMetadata) {
    const metadataString = CMRObjectToString(targetFile, cmrObject);
    await uploadCMRFile(targetFile, metadataString);
    return;
  }
  await copyObject({
    sourceBucket: sourceFile.bucket,
    sourceKey: sourceFile.key,
    destinationBucket: targetFile.bucket,
    destinationKey: targetFile.key,
    chunkSize: s3MultipartChunksizeMb,
  });
}
/**
 * Copy granule files in s3.
 * Any CMRfile will not truly be "copied" but pushed up to new location with new metadata contents
 * any other file will be checked to be sure a copy is actually needed, and then copied over
 */
async function copyGranulesInS3({
  sourceGranules,
  targetGranules,
  cmrObjects,
  s3MultipartChunksizeMb,
}: {
  sourceGranules: Array<ValidGranuleRecord>,
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjects: { [granuleId: string]: Object },
  s3MultipartChunksizeMb?: number,
}): Promise<void> {
  const copyOperations = flatten(await Promise.all(
    zip(sourceGranules, targetGranules).map(
      async ([sourceGranule, targetGranule]) => {
        if (!sourceGranule?.files || !targetGranule?.files) {
          throw new AssertionError({ message: 'size mismatch between target and source granules' });
        }
        return Promise.all(zip(sourceGranule.files, targetGranule.files)
          .map(async ([sourceFile, targetFile]) => {
            if (!(sourceFile && targetFile)) {
              throw new AssertionError({
                message: 'size mismatch between target and source granule files',
              });
            }
            return () => copyFileInS3({
              sourceFile,
              targetFile,
              cmrObject: cmrObjects[targetGranule.granuleId],
              s3MultipartChunksizeMb,
            });
          }));
      }
    )
  ));
  await pMap(
    copyOperations,
    (operation) => operation(),
    { concurrency: 1 }
  );
}

/**
 * Create new ApiFile object updated to new collection data
 */
function updateFileMetadata(
  file: ValidApiGranuleFile,
  granule: ValidGranuleRecord,
  bucketsConfig: BucketsConfig,
  cmrMetadata: Object,
  targetCollection: CollectionRecord
): ValidApiGranuleFile {
  const fileName = path.basename(file.key);
  const match = identifyFileMatch(bucketsConfig, fileName, targetCollection.files);
  const URLPathTemplate = match.url_path || targetCollection.url_path || '';
  const urlPath = urlPathTemplate(URLPathTemplate, {
    file,
    granule: granule,
    cmrMetadata,
  });
  const updatedBucket = bucketsConfig.nameByKey(match.bucket);
  const updatedKey = s3Join(urlPath, fileName);
  return {
    ...file,
    bucket: updatedBucket,
    key: updatedKey,
  };
}

/**
 * Create new granule object with updated details including updated files
 * all according to the given target collection
 */
function updateGranuleMetadata(
  granule: ValidGranuleRecord,
  bucketsConfig: BucketsConfig,
  cmrObjects: { [granuleId: string]: Object },
  targetCollection: CollectionRecord
): ValidGranuleRecord {
  const cmrMetadata = get(cmrObjects, granule.granuleId, {});
  const newFiles = granule.files?.map(
    (file) => updateFileMetadata(
      file,
      granule,
      bucketsConfig,
      cmrMetadata,
      targetCollection
    )
  );
  return {
    ...cloneDeep(granule),
    files: newFiles,
    collectionId: constructCollectionId(
      targetCollection.name,
      targetCollection.version
    ),
  };
}

/**
 * Update the cmr objects to contain data adherant to the target granules they reflect
 */
export async function updateCMRData(
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjectsByGranuleId: { [granuleId: string]: Object },
  cmrFilesByGranuleId: { [granuleId: string]: ValidApiFile },
  config: EventConfig
): Promise<{ [granuleId: string]: Object }> {
  const distEndpoint = getRequiredEnvVar('DISTRIBUTION_ENDPOINT');
  const bucketTypes = Object.fromEntries(Object.values(config.buckets)
    .map(({ name, type }) => [name, type]));
  const cmrGranuleUrlType = get(config, 'cmrGranuleUrlType', 'both');
  const distributionBucketMap = await fetchDistributionBucketMap();
  const outputObjects: { [granuleId: string]: Object } = {};
  targetGranules.forEach((targetGranule) => {
    const cmrFile = cmrFilesByGranuleId[targetGranule.granuleId];
    const cmrObject = cmrObjectsByGranuleId[targetGranule.granuleId];
    if (!(cmrFile && cmrObject)) {
      outputObjects[targetGranule.granuleId] = {};
    }
    outputObjects[targetGranule.granuleId] = updateCmrFileCollections({
      collection: config.targetCollection,
      cmrFileName: cmrFile.key,
      cmrObject,
      files: (targetGranule as ValidGranuleRecord).files,
      distEndpoint,
      bucketTypes,
      cmrGranuleUrlType,
      distributionBucketMap,
    });
  });
  return outputObjects;
}

/**
 * Build a set of granules according to new collection
 * New granules reference new collectionId as their collectionId
 * files for new granules are updated according to new collection url_path
 * file names are *not* updated
 */
function buildTargetGranules(
  granules: Array<ValidGranuleRecord>,
  config: EventConfig,
  cmrObjects: { [granuleId: string]: Object },
  targetCollection: CollectionRecord
): Array<ValidGranuleRecord> {
  const bucketsConfig = new BucketsConfig(config.buckets);
  const targetGranules: Array<ValidGranuleRecord> = [];
  const granulesAndMetadata = granules.map(
    (granule) => updateGranuleMetadata(
      granule,
      bucketsConfig,
      cmrObjects,
      targetCollection
    )
  );
  granulesAndMetadata.forEach((targetGranule) => {
    targetGranules.push(targetGranule);
  });
  return targetGranules;
}

async function changeGranuleCollectionS3(event: ChangeCollectionsS3Event): Promise<Object> {
  const config = event.config;
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : Number(process.env.default_s3_multipart_chunksize_mb);

  const chunkSize = s3MultipartChunksizeMb ? s3MultipartChunksizeMb * MB : undefined;
  const targetCollection = await getCollection({
    prefix: getRequiredEnvVar('stackName'),
    collectionName: config.targetCollection.name,
    collectionVersion: config.targetCollection.version,
  });

  log.debug(`change-granule-collection-s3 config: ${JSON.stringify(event.config)}`);

  const granuleIds = event.input.granuleIds;
  const tempGranulesInput = await Promise.all(granuleIds.map((granuleId) => getGranule({
    prefix: getRequiredEnvVar('stackName'),
    granuleId,
  })));
  const invalidBehavior = config.invalidBehavior || 'skip';
  let granulesInput: Array<ValidGranuleRecord>;
  if (invalidBehavior === 'skip') {
    granulesInput = tempGranulesInput.filter((granule) => {
      if (!apiGranuleRecordIsValid(granule)) {
        log.warn(`granule has unparseable file details ${granule}`);
        return false;
      }
      return true;
    }) as ValidGranuleRecord[];
  } else {
    tempGranulesInput.forEach((granule) => {
      if (!apiGranuleRecordIsValid(granule)) {
        throw new Error(`granule has unparseable file details ${granule}`);
      }
    });
    granulesInput = tempGranulesInput as ValidGranuleRecord[];
  }
  const cmrFiles: Array<ValidApiFile> = granulesToCmrFileObjects(
    granulesInput,
    isCMRFile
  ) as ValidApiFile[];
  const cmrFilesByGranuleId: { [granuleId: string]: ValidApiFile } = keyBy(cmrFiles, 'granuleId');
  const firstCMRObjectsByGranuleId: { [granuleId: string]: Object } = {};
  await Promise.all(cmrFiles.map(async (cmrFile) => {
    firstCMRObjectsByGranuleId[cmrFile.granuleId] = await metadataObjectFromCMRFile(
      `s3://${cmrFile.bucket}/${cmrFile.key}`
    );
  }));
  const collectionUpdatedCMRMetadata = await updateCMRData(
    granulesInput, firstCMRObjectsByGranuleId, cmrFilesByGranuleId,
    config
  );

  const targetGranules = await buildTargetGranules(
    granulesInput, config, collectionUpdatedCMRMetadata, targetCollection
  );
  const updatedCMRObjects = await updateCMRData(
    targetGranules, collectionUpdatedCMRMetadata, cmrFilesByGranuleId,
    config
  );
  // Move files from staging location to final location
  await copyGranulesInS3({
    sourceGranules: granulesInput,
    targetGranules,
    cmrObjects: updatedCMRObjects,
    s3MultipartChunksizeMb: chunkSize,
  });

  return {
    granules: targetGranules,
    oldGranules: granulesInput,
  };
}

/**
 * Lambda handler
 */
async function handler(event: CumulusMessage, context: Context): Promise<Object> {
  return await runCumulusTask(changeGranuleCollectionS3, event, context);
}

exports.handler = handler;
exports.changeGranuleCollectionS3 = changeGranuleCollectionS3;
