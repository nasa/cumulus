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
import { MissingS3FileError, DuplicateFile, InvalidArgument } from '@cumulus/errors';
import { S3 } from '@cumulus/aws-client';
import { updateGranuleAndFiles, getKnexClient } from '@cumulus/db';
import { CMR } from '@cumulus/cmr-client';
import {
  unversionFilename,
} from '@cumulus/ingest/granule';
import {
  isCMRFile,
  isISOFile,
  metadataObjectFromCMRFile,
  granulesToCmrFileObjects,
} from '@cumulus/cmrjs';
import { BucketsConfig } from '@cumulus/common';
import { urlPathTemplate } from '@cumulus/ingest/url-path-template';
import { isFileExtensionMatched } from '@cumulus/message/utils';
import { constructCollectionId } from '@cumulus/message/Collections';
import { log } from '@cumulus/common';
import { ApiGranule, DuplicateHandling } from '@cumulus/types';
import { ApiFile } from '@cumulus/types/api/files';
import { AssertionError } from 'assert';
import { CumulusMessage } from '@cumulus/types/message';
import { CMRFile } from '@cumulus/cmrjs/types';
import { CollectionFile } from '@cumulus/types';
import { BucketsConfigObject } from '@cumulus/common/types';
import { getCmrSettings } from '@cumulus/cmrjs/cmr-utils';
import { CMRConstructorParams } from '@cumulus/cmr-client/CMR';
import { s3CopyObject } from '@cumulus/aws-client/S3';

const MB = 1024 * 1024;

interface EventConfig {
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
}

interface MoveGranuleCollectionsEvent {
  config: EventConfig,
  cumulus_config?: {
    cumulus_context?: {
      forceDuplicateOverwrite?: boolean,
    }
  },
  input: {
    granules: Array<ApiGranule>,
  }
}

interface ValidApiFile extends ApiFile {
  bucket: string,
  key: string
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

function apiFileIsValid(file: Omit<ApiFile, 'granuleId'>): file is ValidApiFile {
  if (file.bucket === undefined || file.key === undefined) {
    return false;
  }
  return true;
}

function isCMRMetadataFile(file: ApiFile | Omit<ApiFile, 'granuleId'>): boolean {
  return file.type === 'metadata';
}

function moveRequested(
  sourceFile: ValidApiFile,
  targetFile: ValidApiFile
): boolean {
  return !((sourceFile.key === targetFile.key) && (sourceFile.bucket === targetFile.bucket));
}

async function s3MoveNeeded(
  sourceFile: ValidApiFile,
  targetFile: ValidApiFile,
  isMetadataFile: boolean
): Promise<boolean> {
  if (!moveRequested(sourceFile, targetFile)) {
    return false;
  }
  log.warn('going to check if target exists', { Bucket: targetFile.bucket, Key: targetFile.key }, isMetadataFile)
  const targetExists = await S3.s3ObjectExists({ Bucket: targetFile.bucket, Key: targetFile.key });
  /**
   * cmrmetadata file must skip duplicate behavior since it will
   * intentionally be duplicated during first move. It should be impossible to get here with
   * target and *not* source existing, but this is not a normal duplicate situation.
   * this is because old cmrfile won't be deleted until after postgres record is updated
  */
  if (isMetadataFile) {
    if (targetExists) {
      return false;
    }
    return true;
  }
  log.warn('going to check if source exists', { Bucket: sourceFile.bucket, Key: sourceFile.key }, isMetadataFile)
  const sourceExists = await S3.s3ObjectExists({ Bucket: sourceFile.bucket, Key: sourceFile.key });
  if (targetExists && sourceExists) {
    // TODO should this use duplicateHandling?
    throw new DuplicateFile(`target location ${JSON.stringify({ Bucket: targetFile.bucket, Key: targetFile.key })} already occupied`);
  }
  if (sourceExists) {
    return true;
  }
  if (targetExists) {
    return false;
  }
  throw new MissingS3FileError(`source location ${{ Bucket: targetFile.bucket, Key: targetFile.key }} doesn't exist`);
}

async function moveGranulesInS3(
  sourceGranules: Array<ApiGranule>,
  targetGranules: Array<ApiGranule>,
  s3MultipartChunksizeMb?: number
): Promise<void> {
  await Promise.all(
    zip(sourceGranules, targetGranules).map(async ([sourceGranule, targetGranule]) => {
      if (!sourceGranule?.files || !targetGranule?.files) {
        return null;
      }
    
      for(let i = 0; i < sourceGranule.files.length; i += 1){
        const sourceFile = sourceGranule.files[i];
        const targetFile = targetGranule.files[i];
        if (!(sourceFile && targetFile)) {
          continue;
        }
        if (!apiFileIsValid(sourceFile) || !apiFileIsValid(targetFile)) {
          throw new AssertionError({ message: '' });
        }
        const isMetadataFile = isCMRMetadataFile(targetFile);
        if (!await s3MoveNeeded(sourceFile, targetFile, isMetadataFile)) {
          continue;
        }
        log.warn('attempting to do something with', JSON.stringify(sourceFile, null, 2), JSON.stringify(targetFile, null, 2));
        if (isMetadataFile) {
          await s3CopyObject({
            Bucket: targetFile.bucket,
            Key: targetFile.key,
            CopySource: `${sourceFile.bucket}/${sourceFile.key}`,
          });
        } else {
          await S3.moveObject({
            sourceBucket: sourceFile.bucket,
            sourceKey: sourceFile. key,
            destinationBucket: targetFile.bucket,
            destinationKey: targetFile.key,
            chunkSize: s3MultipartChunksizeMb,
          });
          log.warn('succesfully moved', JSON.stringify(sourceFile, null, 2), JSON.stringify(targetFile, null, 2));
        }
      }
      return;
      // return Promise.all(zip(sourceGranule.files, targetGranule.files)
      //   .map(async ([sourceFile, targetFile]) => {
      //     if (!(sourceFile && targetFile)) {
      //       return;
      //     }
      //     if (!apiFileIsValid(sourceFile) || !apiFileIsValid(targetFile)) {
      //       throw new AssertionError({ message: '' });
      //     }
      //     const isMetadataFile = isCMRMetadataFile(targetFile);
      //     if (!await s3MoveNeeded(sourceFile, targetFile, isMetadataFile)) {
      //       return;
      //     }
      //     log.warn('attempting to do something with', JSON.stringify(sourceFile, null, 2), JSON.stringify(targetFile, null, 2));
      //     if (isMetadataFile) {
      //       await s3CopyObject({
      //         Bucket: targetFile.bucket,
      //         Key: targetFile.key,
      //         CopySource: `${sourceFile.bucket}/${sourceFile.key}`,
      //       });
      //     } else {
      //       await S3.moveObject({
      //         sourceBucket: sourceFile.bucket,
      //         sourceKey: sourceFile. key,
      //         destinationBucket: targetFile.bucket,
      //         destinationKey: targetFile.key,
      //         chunkSize: s3MultipartChunksizeMb,
      //       });
      //       log.warn('succesfully moved', JSON.stringify(sourceFile, null, 2), JSON.stringify(targetFile, null, 2));
      //     }
      //   }));
    })
  );
}

async function moveGranulesInCumulusDatastores(
  targetGranules: Array<ApiGranule>
): Promise<void> {
  const knex = await getKnexClient();
  await updateGranuleAndFiles(knex, targetGranules);
}

async function cleanupCMRMetadataFiles(
  sourceGranules: Array<ApiGranule>,
  targetGranules: Array<ApiGranule>
) {
  await Promise.all(
    zip(sourceGranules, targetGranules).map(async ([sourceGranule, targetGranule]) => {
      if (sourceGranule?.files === undefined || targetGranule?.files === undefined) {
        return null;
      }
      return Promise.all(zip(sourceGranule.files, targetGranule.files)
        .map(async ([sourceFile, targetFile]) => {
          if (!(sourceFile && targetFile)) {
            return;
          }
          if (!isCMRMetadataFile(targetFile)) {
            return;
          }
          if (!apiFileIsValid(sourceFile) || !apiFileIsValid(targetFile)) {
            throw new AssertionError({ message: '' });
          }
          if (
            moveRequested(sourceFile, targetFile) &&
            await S3.s3ObjectExists({ Bucket: sourceFile.bucket, Key: sourceFile.key })
          ) {
            await S3.deleteS3Object(sourceFile.bucket, sourceFile.key);
          }
          
        }));
    })
  );
}

/**
 * Move all files in a collection of granules from staging location to final location,
 * and update granule files to include renamed files if any.
 */
async function moveFilesForAllGranules(
  sourceGranules: Array<ApiGranule>,
  targetGranules: Array<ApiGranule>,
  s3MultipartChunksizeMb?: number
): Promise<void> {
  /**
  * in order to parse targetGranules, specifically url_path for the files
  * in the case that the collection is declared with a templated url_path,
  * we must be able to find the cmrMetadata files in their original location untill all is done
  */
  // move all non-cmrMetadata files and copy all cmrmetadata files
  await moveGranulesInS3(sourceGranules, targetGranules, s3MultipartChunksizeMb);
  log.warn('moved in s3')
  // update postgres (or other cumulus datastores if applicable)
  await moveGranulesInCumulusDatastores(
    targetGranules
  );
  log.warn('moved in pg')
  // because cmrMetadata files were *copied* and not deleted, delete them now
  await cleanupCMRMetadataFiles(sourceGranules, targetGranules);
  log.warn('cleanedup')
}

function updateFileMetadata(
  file: Omit<ApiFile, 'granuleId'>,
  granule: ApiGranule,
  config: EventConfig,
  cmrMetadata: Object,
  cmrFileNames: Array<string>
): Omit<ApiFile, 'granuleId'> {
  if (file.key === undefined) {
    throw new AssertionError({ message: 'damn' });
  }
  const bucketsConfig = new BucketsConfig(config.buckets);

  const fileName = path.basename(file.key);
  const cmrFileTypeObject: { type?: string } = {};
  if (cmrFileNames.includes(fileName) && !file.type) {
    cmrFileTypeObject.type = 'metadata';
  }

  const match = identifyFileMatch(bucketsConfig, fileName, config.collection.files);
  const URLPathTemplate = match.url_path || config.collection.url_path || '';
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

async function getCMRMetadata(cmrFile: CMRFile, granuleId: string): Promise<Object> {
  try {
    return metadataObjectFromCMRFile(`s3://${cmrFile.bucket}/${cmrFile.key}`);
  } catch {
    const cmrSettings: CMRConstructorParams = await getCmrSettings();
    const cmr = new CMR(cmrSettings);
    const [granulesOutput] = await cmr.searchGranules({ granuleId }) as Array<Object>;
    return granulesOutput;
  }
}

async function updateGranuleMetadata(
  granule: ApiGranule,
  config: EventConfig,
  cmrFiles: { [key: string]: CMRFile },
  cmrFileNames: Array<string>
): Promise<ApiGranule> {
  log.warn('and our granule is', JSON.stringify(granule, null, 2))
  const cmrFile = get(cmrFiles, granule.granuleId, null);

  const cmrMetadata = cmrFile ?
    await getCMRMetadata(cmrFile, granule.granuleId) :
    {};
  const newFiles = granule.files?.map(
    (file) => updateFileMetadata(file, granule, config, cmrMetadata, cmrFileNames)
  );
  return {
    ...cloneDeep(granule),
    files: newFiles,
    collectionId: constructCollectionId(config.collection.name, config.collection.version),
  };
}

async function buildTargetGranules(
  granules: Array<ApiGranule>,
  config: EventConfig,
  cmrFiles: { [key: string]: CMRFile }
): Promise<Array<ApiGranule>> {
  const cmrFileNames = Object.values(cmrFiles).map((f) => path.basename(f.key));

  return await Promise.all(granules.map(
    async (granule) => updateGranuleMetadata(granule, config, cmrFiles, cmrFileNames)
  ));
}

async function moveGranules(event: MoveGranuleCollectionsEvent): Promise<Object> {
  log.warn(JSON.stringify(event, null, 2));
  const config = event.config;
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : Number(process.env.default_s3_multipart_chunksize_mb);

  const chunkSize = s3MultipartChunksizeMb ? s3MultipartChunksizeMb * MB : undefined;
  const granuleMetadataFileExtension: string = get(
    config,
    'collection.meta.granuleMetadataFileExtension'
  );

  log.debug(`moveGranules config: s3MultipartChunksizeMb: ${s3MultipartChunksizeMb}, `
    + `granuleMetadataFileExtension ${granuleMetadataFileExtension}`);

  const granulesInput = event.input.granules;

  let filterFunc;
  if (granuleMetadataFileExtension) {
    filterFunc = (fileobject: ApiFile) => isFileExtensionMatched(
      fileobject,
      granuleMetadataFileExtension
    );
  } else {
    filterFunc = (fileobject: ApiFile) => isCMRFile(fileobject) || isISOFile(fileobject);
  }
  const cmrFiles: Array<CMRFile> = granulesToCmrFileObjects(granulesInput, filterFunc);
  const cmrFilesByGranuleId: Dictionary<CMRFile> = keyBy(cmrFiles, 'granuleId');

  const targetGranules = await buildTargetGranules(
    granulesInput, config, cmrFilesByGranuleId
  );
  log.warn('built targets');

  // Move files from staging location to final location
  await moveFilesForAllGranules(
    granulesInput, targetGranules, chunkSize
  );
  log.warn('moved_files')

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
