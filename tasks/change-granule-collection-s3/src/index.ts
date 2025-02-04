'use strict';

import { Context } from 'aws-lambda';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import get from 'lodash/get';
import keyBy from 'lodash/keyBy';
import cloneDeep from 'lodash/cloneDeep';
import zip from 'lodash/zip';
// eslint-disable-next-line lodash/import-scope
import { Dictionary } from 'lodash';
import path from 'path';
import pMap from 'p-map';
import { MissingS3FileError, InvalidArgument } from '@cumulus/errors';
import { S3 } from '@cumulus/aws-client';
import {
  unversionFilename,
} from '@cumulus/ingest/granule';
import {
  isCMRFile,
  granulesToCmrFileObjects,
  metadataObjectFromCMRFile,
} from '@cumulus/cmrjs';
import { BucketsConfig } from '@cumulus/common';
import { urlPathTemplate } from '@cumulus/ingest/url-path-template';
import { constructCollectionId } from '@cumulus/message/Collections';
import { getCollection } from '@cumulus/api-client/collections';
import { log } from '@cumulus/common';
import { CollectionRecord } from '@cumulus/types';
import { CumulusMessage } from '@cumulus/types/message';
import { CollectionFile } from '@cumulus/types';
import { BucketsConfigObject } from '@cumulus/common/types';
import { copyObject } from '@cumulus/aws-client/S3';
import { getGranule } from '@cumulus/api-client/granules';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { fetchDistributionBucketMap } from '@cumulus/distribution-utils';
import { AssertionError } from 'assert';
import { apiGranuleRecordIsValid, isCMRMetadataFile, updateCmrFileCollections, uploadCMRFile, ValidApiFile, ValidGranuleRecord } from './update_cmr_file_collection';

const MB = 1024 * 1024;

type EventConfig = {
  targetCollection: {
    name: string,
    version: string,
  }
  buckets: BucketsConfigObject,
  s3MultipartChunksizeMb?: number,
  distribution_endpoint: string,
  cmrGranuleUrlType: string,
  invalidBehavior: string,
};

type ChangeCollectionsS3Event = {
  config: EventConfig,
  cumulus_config?: {
    cumulus_context?: {
      forceDuplicateOverwrite?: boolean,
    }
  },
  input: {
    granuleIds: Array<string>,
  }
};

function getConcurrency() {
  return Number(process.env.concurrency || 100);
}

/**
 * Is this move a "real" move, or is target location identical to source
 */
function moveRequested(
  sourceFile: Omit<ValidApiFile, 'granuleId'>,
  targetFile: Omit<ValidApiFile, 'granuleId'>
): boolean {
  return !((sourceFile.key === targetFile.key) && (sourceFile.bucket === targetFile.bucket));
}

/**
 * Identify if a file move is needed.
 * File does not need move *if*
 *   - The target bucket/key is the same as source bucket/key
 *   - The target file is already in its expected location
 * Otherwise it needs to be moved
 */
async function s3MoveNeeded(
  sourceFile: Omit<ValidApiFile, 'granuleId'>,
  targetFile: Omit<ValidApiFile, 'granuleId'>
): Promise<boolean> {
  // this check is strictly redundant to the next "targetExists" but avoids S3 query if possible
  if (!moveRequested(sourceFile, targetFile)) {
    return false;
  }

  const targetExists = await S3.s3ObjectExists({ Bucket: targetFile.bucket, Key: targetFile.key });
  if (targetExists) {
    return false;
  }

  const sourceExists = await S3.s3ObjectExists({ Bucket: sourceFile.bucket, Key: sourceFile.key });
  if (sourceExists) {
    return true;
  }
  throw new MissingS3FileError(`source location ${{ Bucket: targetFile.bucket, Key: targetFile.key }} doesn't exist`);
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
  cmrObjects: { [key: string]: Object },
  s3MultipartChunksizeMb?: number,
}): Promise<void> {
  await pMap(
    zip(sourceGranules, targetGranules),
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
          const isMetadataFile = isCMRMetadataFile(targetFile);
          if (isMetadataFile) {
            await uploadCMRFile(targetFile, cmrObjects[targetGranule.granuleId]);
            return;
          }
          if (!await s3MoveNeeded(sourceFile, targetFile)) {
            return;
          }
          if (!isMetadataFile) {
            await copyObject({
              sourceBucket: sourceFile.bucket,
              sourceKey: sourceFile.key,
              destinationBucket: targetFile.bucket,
              destinationKey: targetFile.key,
              chunkSize: s3MultipartChunksizeMb,
            });
          }
        }));
    },
    { concurrency: getConcurrency() }
  );
}

/**
 * Create new file object updated to new collection data
 */
function updateFileMetadata(
  file: Omit<ValidApiFile, 'granuleId'>,
  granule: ValidGranuleRecord,
  bucketsConfig: BucketsConfig,
  cmrMetadata: Object,
  targetCollection: CollectionRecord
): Omit<ValidApiFile, 'granuleId'> {
  const fileName = path.basename(file.key);
  const match = identifyFileMatch(bucketsConfig, fileName, targetCollection.files);
  const URLPathTemplate = match.url_path || targetCollection.url_path || '';
  const urlPath = urlPathTemplate(URLPathTemplate, {
    file,
    granule: granule,
    cmrMetadata,
  });
  const updatedBucket = bucketsConfig.nameByKey(match.bucket);
  const updatedKey = S3.s3Join(urlPath, fileName);
  return {
    ...cloneDeep(file),
    bucket: updatedBucket,
    key: updatedKey,
  };
}

/**
 * Create new granule object with updated details including updated files
 * all according to the given target collection
 */
async function updateGranuleMetadata(
  granule: ValidGranuleRecord,
  bucketsConfig: BucketsConfig,
  cmrObjects: { [key: string]: Object },
  targetCollection: CollectionRecord
): Promise<ValidGranuleRecord> {
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
async function updateCMRData(
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjectsByGranuleId: { [key: string]: Object },
  cmrFilesByGranuleId: Dictionary<ValidApiFile>,
  config: EventConfig
): Promise<{ [key: string]: Object }> {
  const distEndpoint = getRequiredEnvVar('DISTRIBUTION_ENDPOINT');
  const bucketTypes = Object.fromEntries(Object.values(config.buckets)
    .map(({ name, type }) => [name, type]));
  const cmrGranuleUrlType = get(config, 'cmrGranuleUrlType', 'both');
  const distributionBucketMap = await fetchDistributionBucketMap();
  const outputObjects: { [key: string]: Object } = {};
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
async function buildTargetGranules(
  granules: Array<ValidGranuleRecord>,
  config: EventConfig,
  cmrObjects: { [key: string]: Object },
  targetCollection: CollectionRecord
): Promise<Array<ValidGranuleRecord>> {
  const bucketsConfig = new BucketsConfig(config.buckets);
  const targetGranules: Array<ValidGranuleRecord> = [];
  const granulesAndMetadata = await Promise.all(granules.map(
    async (granule) => updateGranuleMetadata(
      granule,
      bucketsConfig,
      cmrObjects,
      targetCollection
    )
  ));
  granulesAndMetadata.forEach((targetGranule) => {
    targetGranules.push(targetGranule);
  });
  return targetGranules;
}

async function changeGranuleCollectionS3(event: ChangeCollectionsS3Event): Promise<Object> {
  const config = event.config;
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : Number(process.env.default_s3_multipart_chunksize_mb);

  const chunkSize = s3MultipartChunksizeMb ? s3MultipartChunksizeMb * MB : undefined;\
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
  const cmrFilesByGranuleId: Dictionary<ValidApiFile> = keyBy(cmrFiles, 'granuleId');
  const firstCMRObjectsByGranuleId: { [key: string]: Object } = {};
  await Promise.all(cmrFiles.map(async (cmrFile) => {
    firstCMRObjectsByGranuleId[cmrFile.granuleId] = await metadataObjectFromCMRFile(
      `s3://${cmrFile.bucket}/${cmrFile.key}`
    );
  }));
  const collectionUpdatedCMRMetadata = await updateCMRData(
    granulesInput, firstCMRObjectsByGranuleId, cmrFilesByGranuleId,
    config
  );
  log.debug('checking the weird? state of collectionUpdatedCMRMetadata', JSON.stringify(collectionUpdatedCMRMetadata))
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
