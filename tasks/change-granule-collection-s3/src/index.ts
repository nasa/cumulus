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
import { apiGranuleRecordIsValid, getCMRMetadata, isCMRMetadataFile, updateCmrFileCollections, uploadCMRFile, ValidApiFile, ValidGranuleRecord } from './update_cmr_file_collection';

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
  bucketsConfig: BucketsConfig,
  cmrMetadata: Object,
  cmrFileNames: Array<string>,
  targetCollection: CollectionRecord
): Omit<ValidApiFile, 'granuleId'> {
  const fileName = path.basename(file.key);
  const cmrFileTypeObject: { type?: string } = {};
  if (cmrFileNames.includes(fileName) && !file.type) {
    cmrFileTypeObject.type = 'metadata';
  }

  const match = identifyFileMatch(bucketsConfig, fileName, targetCollection.files);
  const URLPathTemplate = match.url_path || targetCollection.url_path || '';
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
  bucketsConfig: BucketsConfig,
  cmrFiles: { [key: string]: ValidApiFile },
  cmrFileNames: Array<string>,
  targetCollection: CollectionRecord
): Promise<{
    targetGranule: ValidGranuleRecord,
    cmrObject: Object
  }> {
  const cmrFile = get(cmrFiles, granule.granuleId, null);

  const cmrMetadata = cmrFile ?
    await getCMRMetadata(cmrFile, granule.granuleId) :
    {};
  const newFiles = granule.files?.map(
    (file) => updateFileMetadata(
      file,
      granule,
      bucketsConfig,
      cmrMetadata,
      cmrFileNames,
      targetCollection
    )
  );
  return {
    targetGranule: {
      ...cloneDeep(granule),
      files: newFiles,
      collectionId: constructCollectionId(
        targetCollection.name,
        targetCollection.version
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
  const distEndpoint = getRequiredEnvVar('DISTRIBUTION_ENDPOINT');
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
  cmrFiles: { [key: string]: ValidApiFile },
  targetCollection: CollectionRecord
): Promise<{
    targetGranules: Array<ValidGranuleRecord>,
    cmrObjects: Array<Object>,
  }> {
  const bucketsConfig = new BucketsConfig(config.buckets);
  const cmrFileNames = Object.values(cmrFiles).map((f) => path.basename(f.key));
  const targetGranules: Array<ValidGranuleRecord> = [];
  const cmrObjects: Array<Object> = [];
  const granulesAndMetadata = await Promise.all(granules.map(
    async (granule) => updateGranuleMetadata(
      granule,
      bucketsConfig,
      cmrFiles,
      cmrFileNames,
      targetCollection
    )
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

  const targetCollection = await getCollection({
    prefix: getRequiredEnvVar('stackName'),
    collectionName: config.targetCollection.name,
    collectionVersion: config.targetCollection.version,
  });

  log.debug(`change-granule-collection-s3 config: ${JSON.stringify(event)}`);

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

  const {
    targetGranules,
    cmrObjects,
  } = await buildTargetGranules(
    granulesInput, config, cmrFilesByGranuleId, targetCollection
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
