'use strict';

import { Context } from 'aws-lambda';
import get from 'lodash/get';
import keyBy from 'lodash/keyBy';
import cloneDeep from 'lodash/cloneDeep';
import { AssertionError } from 'assert';
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
  metadataObjectFromCMRFile,
} from '@cumulus/cmrjs';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { s3 } from '@cumulus/aws-client/services';
import { BucketsConfig, log } from '@cumulus/common';
import { urlPathTemplate } from '@cumulus/ingest/url-path-template';
import { constructCollectionId } from '@cumulus/message/Collections';
import { getCollection } from '@cumulus/api-client/collections';
import { getGranule } from '@cumulus/api-client/granules';
import { CollectionRecord, CollectionFile } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { calculateObjectHash, copyObject, s3Join, s3ObjectExists } from '@cumulus/aws-client/S3';
import { fetchDistributionBucketMap } from '@cumulus/distribution-utils';
import { getCMRCollectionId } from '@cumulus/cmrjs/cmr-utils';
import {
  MB,
  EventConfig,
  ChangeCollectionsS3Event,
  ValidApiGranuleFile,
  ValidGranuleRecord,
  MassagedEventConfig,
  ValidApiFile,
} from './types';
import {
  validateApiGranuleRecord,
  CMRObjectToString,
  updateCmrFileCollection,
  updateCmrFileLinks,
  uploadCMRFile,
  validateApiFile,
} from './update_cmr_file_collection';

/**
 * Boolean are these files in the same location
 */
function objectSourceAndTargetSame(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile
): boolean {
  return ((sourceFile.key === targetFile.key) && (sourceFile.bucket === targetFile.bucket));
}

async function metadataCollisionsMatch(
  targetFile: ValidApiGranuleFile,
  metadataObject: Object
): Promise<boolean> {
  const existingGranuleMetadata = await pRetry(
    () => metadataObjectFromCMRFile(
      `s3://${targetFile.bucket}/${targetFile.key}`
    ),
    { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
  );
  const sourceCollection = getCMRCollectionId(metadataObject, targetFile.key);
  const targetCollection = getCMRCollectionId(existingGranuleMetadata, targetFile.key);
  return sourceCollection === targetCollection;
}

async function checkSumsMatch(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile
): Promise<boolean> {
  const [sourceHash, targetHash] = await Promise.all([
    pRetry(
      () => calculateObjectHash({ s3: s3(), algorithm: 'CKSUM', ...sourceFile }),
      { retries: 3, minTimeout: 2000, maxTimeout: 2000 }
    ),
    pRetry(
      () => calculateObjectHash({ s3: s3(), algorithm: 'CKSUM', ...targetFile }),
      { retries: 3, minTimeout: 2000, maxTimeout: 2000 }
    ),
  ]);

  return sourceHash === targetHash;
}

/**
 * Identify if an s3 file needs to be copied.
 * File does not need move *if*
 *   - The target bucket/key is the same as source bucket/key
 *   - The target file is already in its expected location
 * Otherwise it needs to be moved
 * this throws an error if there is a file in the target location but *not* a copy of source
 */
export async function s3CopyNeeded(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile
): Promise<boolean> {
  // this check is strictly redundant, but allows us to skip some s3 calculations if possible
  if (objectSourceAndTargetSame(sourceFile, targetFile)) {
    return false;
  }

  const [targetExists, sourceExists] = await Promise.all([
    pRetry(
      () =>
        s3ObjectExists({ Bucket: targetFile.bucket, Key: targetFile.key }),
      {
        retries: 3,
        minTimeout: 2000,
        maxTimeout: 2000,
        onFailedAttempt: (error) => {
          log.warn(
            `Error when checking for object ${{
              Bucket: targetFile?.bucket,
              Key: targetFile?.key,
            }} :: ${error}, retrying`
          );
        },
      }
    ),
    pRetry(
      async () =>
        s3ObjectExists({ Bucket: sourceFile.bucket, Key: sourceFile.key }),
      {
        retries: 3,
        minTimeout: 2000,
        maxTimeout: 2000,
        onFailedAttempt: (error) => {
          log.warn(
            `Error when checking for object ${{
              Bucket: sourceFile?.bucket,
              Key: sourceFile?.key,
            }} :: ${error}, retrying`
          );
        },
      }
    ),
  ]);
  //this is the normal happy path
  if (sourceExists && !targetExists) {
    return true;
  }
  // either this granule is being reprocessed *or* there's a file collision between collections
  if (sourceExists && targetExists) {
    if (await checkSumsMatch(sourceFile, targetFile)) {
      // this file was already moved, but is being reprocessed
      // presumably because of a failure elsewhere in the workflow
      return false;
    }
    throw new DuplicateFile(
      `file Bucket: ${targetFile?.bucket}, Key: ${targetFile?.key} already exists.` +
      'cannot copy over without deleting existing data'
    );
  }
  log.warn(
    `source location Bucket: ${sourceFile?.bucket}, Key: ${sourceFile?.key}` +
    "doesn't exist, has this file already been moved?"
  );
  return false;
}

/**
 * Validates the file matched only one file in collection configuration and has a valid bucket
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

async function cmrFileCollision(
  sourceFile: ValidApiGranuleFile,
  targetFile: ValidApiGranuleFile,
  cmrObject: Object
) {
  // if these are the same, we need to *update* that metadata
  if (objectSourceAndTargetSame(sourceFile, targetFile)) {
    return false;
  }
  if (
    !(await pRetry(
      () =>
        s3ObjectExists({
          Bucket: targetFile.bucket,
          Key: targetFile.key,
        }),
      {
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 2000,
        onFailedAttempt: (error) => {
          log.warn(`failed attempt to check for target collision when moving CMR file ${targetFile?.bucket}/${targetFile?.key} :: ${error}, retrying`);
        },
      }
    ))
  ) {
    return false;
  }
  if (!await metadataCollisionsMatch(targetFile, cmrObject)) {
    throw new DuplicateFile(
      `metadata file Bucket: ${targetFile?.bucket}, Key: ${targetFile?.key} already exists.` +
      'and does not appear to belong to the collection being moved'
    );
  }
  return false;
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
  if (isCMRFile(targetFile)) {
    if (!(await cmrFileCollision(sourceFile, targetFile, cmrObject))) {
      const metadataString = CMRObjectToString(targetFile, cmrObject);
      await pRetry(() => uploadCMRFile(targetFile, metadataString), {
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 2000,
        onFailedAttempt: (error) => {
          log.warn(
            `failed attempt to upload CMR file ${targetFile?.bucket}/${targetFile?.key} ::  ${error}, retrying`
          );
        },
      });
    }
    return;
  }
  if (await s3CopyNeeded(sourceFile, targetFile)) {
    await pRetry(
      () =>
        copyObject({
          sourceBucket: sourceFile.bucket,
          sourceKey: sourceFile.key,
          destinationBucket: targetFile.bucket,
          destinationKey: targetFile.key,
          chunkSize: s3MultipartChunksizeMb,
        }),
      {
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 2000,
        onFailedAttempt: (error) => {
          log.warn(
            `Error when copying object ${sourceFile?.bucket}/${sourceFile?.key} to target ${targetFile?.bucket}/${targetFile?.key} ::  ${error}, retrying`
          );
        },
      }
    );
  }
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
  concurrency?: number,
}): Promise<void> {
  const sourceGranulesById = keyBy(sourceGranules, 'granuleId');

  const copyOperations = flatten(targetGranules.map(
    (targetGranule) => {
      const sourceGranule = sourceGranulesById[targetGranule.granuleId];
      if (!sourceGranule) {
        throw new AssertionError({ message: 'no source granule for your target granule by ID' });
      }
      if (!sourceGranule.files || !targetGranule.files) {
        return [];
      }
      const sourceFilesByFileName = keyBy(sourceGranule.files, (file) => path.basename(file.key));
      return targetGranule.files.map((targetFile) => {
        const sourceFile = sourceFilesByFileName[path.basename(targetFile.key)];
        if (!sourceFile) {
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
      });
    }
  ));
  await pMap(
    copyOperations,
    (operation) => operation(),
    { concurrency: 5 }
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
 *   - update granuleId
 *   - update bucket for each file
 *   - update url prefix for each file
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
 * Update the cmr objects to contain data adherent to the target granules they reflect
 */
export async function updateCMRData(
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjectsByGranuleId: { [granuleId: string]: Object },
  cmrFilesByGranuleId: { [granuleId: string]: ValidApiFile },
  config: MassagedEventConfig
): Promise<{ [granuleId: string]: Object }> {
  const distEndpoint = config.distribution_endpoint || getRequiredEnvVar('DISTRIBUTION_ENDPOINT');
  const bucketTypes = Object.fromEntries(Object.values(config.buckets)
    .map(({ name, type }) => [name, type]));
  const distributionBucketMap = await fetchDistributionBucketMap();
  const outputObjects: { [granuleId: string]: Object } = {};
  targetGranules.forEach((targetGranule) => {
    const cmrFile = cmrFilesByGranuleId[targetGranule.granuleId];
    const cmrObject = cmrObjectsByGranuleId[targetGranule.granuleId];
    if (!(cmrFile && cmrObject)) {
      outputObjects[targetGranule.granuleId] = {};
    } else {
      outputObjects[targetGranule.granuleId] = updateCmrFileLinks({
        cmrFileName: cmrFile.key,
        cmrObject,
        files: (targetGranule as ValidGranuleRecord).files,
        distEndpoint,
        bucketTypes,
        cmrGranuleUrlType: config.cmrGranuleUrlType,
        distributionBucketMap,
      });
    }
  });
  return outputObjects;
}

export function updateCMRCollections(
  cmrObjectsByGranuleId: { [granuleId: string]: Object },
  cmrFilesByGranuleId: { [granuleId: string]: ValidApiFile },
  config: MassagedEventConfig
): { [granuleId: string]: Object } {
  const outputObjects: { [granuleId: string]: Object } = {};
  Object.keys(cmrObjectsByGranuleId).forEach((granuleId) => {
    const cmrFile = cmrFilesByGranuleId[granuleId];
    const cmrObject = cmrObjectsByGranuleId[granuleId];
    outputObjects[granuleId] = updateCmrFileCollection({
      collection: config.targetCollection,
      cmrFileName: cmrFile.key,
      cmrObject,
    });
  });
  return outputObjects;
}

/**
 * Build a set of granules according to new collection
 * New granules reference new collectionId as their collectionId
 * files for new granules are updated according to new collection url_path
 * updates bucket and key
 * fileName is *not* updated
 */
function buildTargetGranules(
  granules: Array<ValidGranuleRecord>,
  config: MassagedEventConfig,
  cmrObjects: { [granuleId: string]: Object }
): Array<ValidGranuleRecord> {
  const bucketsConfig = new BucketsConfig(config.buckets);
  const targetGranules: Array<ValidGranuleRecord> = [];
  const granulesAndMetadata = granules.map(
    (granule) => updateGranuleMetadata(
      granule,
      bucketsConfig,
      cmrObjects,
      config.targetCollection
    )
  );
  granulesAndMetadata.forEach((targetGranule) => {
    targetGranules.push(targetGranule);
  });
  return targetGranules;
}

/**
 * convert granule IDs into full granules, validating that each granule is moveable
 * and acting as configured with any that arenot moveable
 */
async function getAndValidateGranules(
  granuleIds: Array<string>,
  config: MassagedEventConfig
): Promise<Array<ValidGranuleRecord>> {
  const getGranuleMethod = config.testApiClientMethods?.getGranuleMethod || getGranule;
  const tempGranulesInput = await pMap(
    granuleIds,
    (granuleId) => getGranuleMethod({
      prefix: getRequiredEnvVar('stackName'),
      granuleId,
    }),
    { concurrency: 40 },
  )
  let granulesInput: Array<ValidGranuleRecord>;
  if (config.invalidGranuleBehavior === 'skip') {
    granulesInput = tempGranulesInput.filter((granule) => {
      try {
        return validateApiGranuleRecord(granule);
      } catch (error) {
        log.warn(`invalid granule ${granule?.granuleId} skipped because ${error}`);
        return false;
      }
    }).filter(Boolean) as Array<ValidGranuleRecord>;
  } else {
    granulesInput = tempGranulesInput.filter(validateApiGranuleRecord);
  }
  return granulesInput;
}

/**
 * Do math, environment parsing, and api calls to flesh out config with full values
 */
async function getParsedConfigValues(config: EventConfig): Promise<MassagedEventConfig> {
  const getCollectionMethod = config.testApiClientMethods?.getCollectionMethod || getCollection;
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb || Number(
    process.env.default_s3_multipart_chunksize_mb
  );
  const chunkSize = s3MultipartChunksizeMb ? s3MultipartChunksizeMb * MB : undefined;
  const targetCollection = await getCollectionMethod({
    prefix: getRequiredEnvVar('stackName'),
    collectionName: config.targetCollection.name,
    collectionVersion: config.targetCollection.version,
  });

  return {
    ...config,
    chunkSize,
    targetCollection,
    cmrGranuleUrlType: config.cmrGranuleUrlType || 'both',
    invalidGranuleBehavior: config.invalidGranuleBehavior || 'skip',
  };
}

async function getCMRObjectsByFileId(granules: Array<ValidGranuleRecord>): Promise<{
  cmrFilesByGranuleId: { [granuleId: string]: ValidApiFile },
  cmrObjectsByGranuleId: { [granuleId: string]: Object },
}> {
  const unValidatedCMRFiles = granules.flatMap((granule) => {
    if (!granule.files) {
      return [];
    }
    return granule.files?.filter(isCMRFile).map((file) => ({
      ...file,
      granuleId: granule.granuleId,
    }));
  });
  const cmrFiles = unValidatedCMRFiles.filter(validateApiFile);
  const cmrFilesByGranuleId: { [granuleId: string]: ValidApiFile } = keyBy(cmrFiles, 'granuleId');
  const cmrObjectsByGranuleId: { [granuleId: string]: Object } = {};
  await pMap(
    cmrFiles,
    async (cmrFile) => {
      cmrObjectsByGranuleId[cmrFile.granuleId] = await pRetry(
        async () =>
          metadataObjectFromCMRFile(`s3://${cmrFile.bucket}/${cmrFile.key}`),
        {
          retries: 5,
          minTimeout: 2000,
          maxTimeout: 2000,
          onFailedAttempt: (error) => {
            log.warn(
              `Error on reading CMR object ${cmrFile?.bucket}/${cmrFile?.key} :: ${error}, retrying`
            );
          },
        }
      );
    },
    { concurrency: 50}
  );
  return {
    cmrFilesByGranuleId,
    cmrObjectsByGranuleId,
  };
}

async function changeGranuleCollectionS3(event: ChangeCollectionsS3Event): Promise<{
  oldGranules: Array<ValidGranuleRecord>,
  granules: Array<ValidGranuleRecord>
}> {
  const config = await getParsedConfigValues(event.config);
  const sourceGranules = await getAndValidateGranules(
    event.input.granuleIds,
    config
  );
  log.debug(`change-granule-collection-s3 config: ${JSON.stringify(config)}`);
  const {
    cmrFilesByGranuleId,
    cmrObjectsByGranuleId: firstCMRObjectsByGranuleId,
  } = await getCMRObjectsByFileId(sourceGranules);

  //  here we update *just* the collection
  // this is because we need that to parse the target file location

  const collectionUpdatedCMRMetadata = updateCMRCollections(
    firstCMRObjectsByGranuleId,
    cmrFilesByGranuleId,
    config
  );

  await updateCMRData(
    sourceGranules, firstCMRObjectsByGranuleId, cmrFilesByGranuleId,
    config
  );

  const targetGranules = buildTargetGranules(
    sourceGranules, config, collectionUpdatedCMRMetadata
  );

  // now we call updateCMRData with our targetGranules to update
  // the cmr file links
  const updatedCMRObjects = await updateCMRData(
    targetGranules, collectionUpdatedCMRMetadata, cmrFilesByGranuleId,
    config
  );
  // Copy files from staging location to final location
  await copyGranulesInS3({
    sourceGranules: sourceGranules,
    targetGranules,
    cmrObjects: updatedCMRObjects,
    s3MultipartChunksizeMb: config.chunkSize,
    concurrency: config.concurrency,
  });

  return {
    granules: targetGranules,
    oldGranules: sourceGranules,
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
