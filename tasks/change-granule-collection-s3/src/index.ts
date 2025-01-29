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
} from '@cumulus/cmrjs';
import { BucketsConfig } from '@cumulus/common';
import { urlPathTemplate } from '@cumulus/ingest/url-path-template';
import { isFileExtensionMatched } from '@cumulus/message/utils';
import { constructCollectionId } from '@cumulus/message/Collections';
import { log } from '@cumulus/common';
import { CollectionRecord, DuplicateHandling } from '@cumulus/types';
import { ApiFile } from '@cumulus/types/api/files';
import { AssertionError } from 'assert';
import { CumulusMessage } from '@cumulus/types/message';
import { CollectionFile } from '@cumulus/types';
import { BucketsConfigObject } from '@cumulus/common/types';
import { CopyObject } from '@cumulus/aws-client/S3';
import { getGranule } from '@cumulus/api-client/granules';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { fetchDistributionBucketMap } from '@cumulus/distribution-utils';
import { apiGranuleRecordIsValid, getCMRMetadata, isCMRMetadataFile, updateCmrFileCollections, uploadCMRFile, ValidApiFile, ValidGranuleRecord } from './update_cmr_file_collection';

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

interface ChangeCollectionsS3Event {
  config: EventConfig,
  cumulus_config?: {
    cumulus_context?: {
      forceDuplicateOverwrite?: boolean,
    }
  },
  input: {
    granules: Array<string>,
  }
}

function getConcurrency() {
  return Number(process.env.concurrency || 100);
}

function moveRequested(
  sourceFile: Omit<ValidApiFile, 'granuleId'>,
  targetFile: Omit<ValidApiFile, 'granuleId'>
): boolean {
  return !((sourceFile.key === targetFile.key) && (sourceFile.bucket === targetFile.bucket));
}

async function s3MoveNeeded(
  sourceFile: Omit<ValidApiFile, 'granuleId'>,
  targetFile: Omit<ValidApiFile, 'granuleId'>
): Promise<boolean> {
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
 * Validates the file matched only one collection.file and has a valid bucket
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
async function moveGranulesInS3({
  sourceGranules,
  targetGranules,
  cmrObjects,
  s3MultipartChunksizeMb,
}: {
  sourceGranules: Array<ValidGranuleRecord>,
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjects: Array<Object>,
  s3MultipartChunksizeMb?: number,
}): Promise<void> {
  await pMap(
    zip(sourceGranules, targetGranules, cmrObjects),
    async ([sourceGranule, targetGranule, cmrObject]) => {
      if (sourceGranule?.files === undefined || targetGranule?.files === undefined) {
        return null;
      }
      return Promise.all(zip(sourceGranule.files, targetGranule.files)
        .map(async ([sourceFile, targetFile]) => {
          if (!(sourceFile && targetFile)) {
            return;
          }
          const isMetadataFile = isCMRMetadataFile(targetFile);
          if (isMetadataFile && cmrObject) {
            await uploadCMRFile(targetFile, cmrObject);
            return;
          }
          if (!await s3MoveNeeded(sourceFile, targetFile)) {
            return;
          }
          if (!isMetadataFile) {
            await CopyObject({
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
 * Move all files in a collection of granules from staging location to final location,
 * and update granule files to include renamed files if any.
 */
async function moveFilesForAllGranules({
  sourceGranules,
  targetGranules,
  cmrObjects,
  s3MultipartChunksizeMb,
}: {
  sourceGranules: Array<ValidGranuleRecord>,
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjects: Array<Object>,
  s3MultipartChunksizeMb?: number,
}): Promise<void> {
  /**
  * in order to parse targetGranules, specifically url_path for the files
  * in the case that the collection is declared with a templated url_path,
  * we must be able to find the cmrMetadata files in their original location untill all is done
  */
  // move all non-cmrMetadata files and copy all cmrmetadata files
  await moveGranulesInS3({
    sourceGranules,
    targetGranules,
    cmrObjects,
    s3MultipartChunksizeMb,
  });
}
function updateFileMetadata(
  file: Omit<ValidApiFile, 'granuleId'>,
  granule: ValidGranuleRecord,
  config: EventConfig,
  cmrMetadata: Object,
  cmrFileNames: Array<string>
): Omit<ValidApiFile, 'granuleId'> {
  if (file.key === undefined) {
    throw new AssertionError();
  }
  const bucketsConfig = new BucketsConfig(config.buckets);

  const fileName = path.basename(file.key);
  const cmrFileTypeObject: { type?: string } = {};
  if (cmrFileNames.includes(fileName) && !file.type) {
    cmrFileTypeObject.type = 'metadata';
  }

  const match = identifyFileMatch(bucketsConfig, fileName, config.targetCollection.files);
  const URLPathTemplate = match.url_path || config.targetCollection.url_path || '';
  const urlPath = urlPathTemplate(URLPathTemplate, {
    file,
    granule: granule,
    cmrMetadata,
  });
  const updatedBucket = bucketsConfig.nameByKey(match.bucket);
  const updatedKey = S3.s3Join(urlPath, fileName);
  const output = {
    ...cloneDeep(file),
    ...cmrFileTypeObject, // Add type if the file is a CMR file
    bucket: updatedBucket,
    key: updatedKey,
  };
  return output;
}

async function updateGranuleMetadata(
  granule: ValidGranuleRecord,
  config: EventConfig,
  cmrFiles: { [key: string]: ValidApiFile },
  cmrFileNames: Array<string>
): Promise<{
    targetGranule: ValidGranuleRecord,
    cmrObject: Object
  }> {
  const cmrFile = get(cmrFiles, granule.granuleId, null);

  const cmrMetadata = cmrFile ?
    await getCMRMetadata(cmrFile, granule.granuleId) :
    {};
  const newFiles = granule.files?.map(
    (file) => updateFileMetadata(file, granule, config, cmrMetadata, cmrFileNames)
  );
  return {
    targetGranule: {
      ...cloneDeep(granule),
      files: newFiles,
      collectionId: constructCollectionId(
        config.targetCollection.name,
        config.targetCollection.version
      ),
    },
    cmrObject: cmrMetadata,
  };
}

async function updateCMRData(
  targetGranules: Array<ValidGranuleRecord>,
  cmrObjects: Array<Object>,
  cmrFilesByGranuleId: Dictionary<ValidApiFile>,
  config: EventConfig
) {
  const distEndpoint = config.distribution_endpoint || getRequiredEnvVar('DISTRIBUTION_ENDPOINT');
  const bucketTypes = Object.fromEntries(Object.values(config.buckets)
    .map(({ name, type }) => [name, type]));
  const cmrGranuleUrlType = get(config, 'cmrGranuleUrlType', 'both');
  const distributionBucketMap = await fetchDistributionBucketMap();
  return zip(targetGranules, cmrObjects).map(
    ([targetGranule, cmrObject]) => updateCmrFileCollections({
      collection: config.targetCollection,
      cmrFileName: cmrFilesByGranuleId[(targetGranule as ValidGranuleRecord).granuleId].key,
      cmrObject: cmrObject as Object,
      files: (targetGranule as ValidGranuleRecord).files,
      distEndpoint,
      bucketTypes,
      cmrGranuleUrlType,
      distributionBucketMap,
    })
  );
}

async function buildTargetGranules(
  granules: Array<ValidGranuleRecord>,
  config: EventConfig,
  cmrFiles: { [key: string]: ValidApiFile }
): Promise<{
    targetGranules: Array<ValidGranuleRecord>,
    cmrObjects: Array<Object>,
  }> {
  const cmrFileNames = Object.values(cmrFiles).map((f) => path.basename(f.key));
  const targetGranules: Array<ValidGranuleRecord> = [];
  const cmrObjects: Array<Object> = [];
  const granulesAndMetadata = await Promise.all(granules.map(
    async (granule) => updateGranuleMetadata(granule, config, cmrFiles, cmrFileNames)
  ));
  granulesAndMetadata.forEach(({ targetGranule, cmrObject }) => {
    targetGranules.push(targetGranule);
    cmrObjects.push(cmrObject);
  });
  return {
    targetGranules,
    cmrObjects,
  };
}

async function moveGranules(event: ChangeCollectionsS3Event): Promise<Object> {
  const config = event.config;
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : Number(process.env.default_s3_multipart_chunksize_mb);

  const chunkSize = s3MultipartChunksizeMb ? s3MultipartChunksizeMb * MB : undefined;
  const granuleMetadataFileExtension: string = get(
    config,
    'collection.meta.granuleMetadataFileExtension'
  );

  log.debug(`moveGranules config: s3MultipartChunksizeMb: ${s3MultipartChunksizeMb}, `
    + `granuleMetadataFileExtension ${granuleMetadataFileExtension}, `
    + `granuleIds ${event.input.granules}, `
    + `meta ${event.config}`);

  const granuleIds = event.input.granules;
  const tempGranulesInput = await Promise.all(granuleIds.map((granuleId) => getGranule({
    prefix: getRequiredEnvVar('stackName'),
    granuleId,
  })));
  const invalidBehavior = config.invalidBehavior;
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
  let filterFunc;
  if (granuleMetadataFileExtension) {
    filterFunc = (fileobject: ApiFile) => isFileExtensionMatched(
      fileobject,
      granuleMetadataFileExtension
    );
  } else {
    filterFunc = (fileobject: ApiFile) => isCMRFile(fileobject);
  }
  const cmrFiles: Array<ValidApiFile> = granulesToCmrFileObjects(
    granulesInput,
    filterFunc
  ) as ValidApiFile[];
  const cmrFilesByGranuleId: Dictionary<ValidApiFile> = keyBy(cmrFiles, 'granuleId');

  const {
    targetGranules,
    cmrObjects,
  } = await buildTargetGranules(
    granulesInput, config, cmrFilesByGranuleId
  );
  const updatedCMRObjects = await updateCMRData(
    targetGranules, cmrObjects, cmrFilesByGranuleId,
    config
  );
  // Move files from staging location to final location
  await moveFilesForAllGranules({
    sourceGranules: granulesInput,
    targetGranules,
    cmrObjects: updatedCMRObjects,
    s3MultipartChunksizeMb: chunkSize,
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
