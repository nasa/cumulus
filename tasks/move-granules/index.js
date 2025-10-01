//@ts-check

'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash/get');
const flatten = require('lodash/flatten');
const keyBy = require('lodash/keyBy');
const isObject = require('lodash/isObject');
const path = require('path');

const S3 = require('@cumulus/aws-client/S3');

const { InvalidArgument, ValidationError, FileNotFound } = require('@cumulus/errors');

const { getRequiredEnvVar } = require('@cumulus/common/env');

const {
  handleDuplicateFile,
  unversionFilename,
  duplicateHandlingType,
} = require('@cumulus/ingest/granule');

const {
  isCMRFile,
  isISOFile,
  metadataObjectFromCMRFile,
  granulesToCmrFileObjects,
} = require('@cumulus/cmrjs');

const { getFileGranuleAndCollectionByBucketAndKey } = require('@cumulus/api-client/granules');

const BucketsConfig = require('@cumulus/common/BucketsConfig');

const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');
const { isFileExtensionMatched } = require('@cumulus/message/utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const log = require('@cumulus/common/log');

// Import type definitions
/**
 * @typedef {import('./types').BucketsConfigObject} BucketsConfigObject
 * @typedef {import('./types').ApiGranule} ApiGranule
 * @typedef {import('./types').ApiCollection} ApiCollection
 * @typedef {import('./types').DuplicateHandling} DuplicateHandling
 * @typedef {import('./types').MoveGranulesFile} MoveGranulesFile
 * @typedef {import('./types').MoveGranulesFileWithSourceKey} MoveGranulesFileWithSourceKey
 * @typedef {import('./types').MoveGranulesGranule} MoveGranulesGranule
 * @typedef {import('./types').MoveGranulesGranuleOptionalFilesFields}
 * MoveGranulesGranuleOptionalFilesFields
 * @typedef {import('./types').GranulesObject} GranulesObject
 * @typedef {import('./types').GranulesOutputObject} GranulesOutputObject
 * @typedef {import('./types').CollectionFile} CollectionFile
 * @typedef {import('./types').Collection} Collection
 * @typedef {import('./types').S3Object} S3Object
 * @typedef {import('@cumulus/cmrjs/cmr-utils').CmrFile} CmrFile
 * @typedef {import('./types').GranuleFileInfo} GranuleFileInfo
 * @typedef {import('@cumulus/types/message').CumulusMessage}  CumulusMessage
 * @typedef {import('aws-lambda').Context} Context
 */

const MB = 1024 * 1024;
const HTTP_NOT_FOUND = 404;

/**
 * Builds a granule duplicates object from moved granules
 *
 * This function identifies files that were detected as duplicates during moving
 * and builds an object mapping granule IDs to lists of duplicate files.
 *
 * @param {GranulesOutputObject} movedGranulesByGranuleId - Object mapping granule IDs
 * to granule objects
 * @returns {Object.<string, {files: MoveGranulesFile[]}>} Object
 * containing duplicate file information
 */
function buildGranuleDuplicatesObject(movedGranulesByGranuleId) {
  /** @type {Object.<string, {files: MoveGranulesFile[]}>} */
  const duplicatesObject = {};
  Object.keys(movedGranulesByGranuleId).forEach((k) => {
    duplicatesObject[k] = {
      files: movedGranulesByGranuleId[k].files.filter((file) => {
        if (file.duplicate_found) {
          // eslint-disable-next-line no-param-reassign
          delete file.duplicate_found;
          return true;
        }
        return false;
      }),
    };
  });
  return duplicatesObject;
}

/**
 * Validates the file matched only one collection.file and has a valid bucket
 * config.
 *
 * This function checks that a file name matches exactly one collection file pattern
 * and that the specified bucket exists in the configuration.
 *
 * @param {CollectionFile[]} match - list of matched collection.file
 * @param {BucketsConfig} bucketsConfig - instance describing stack configuration
 * @param {string} fileName - the file name tested
 * @param {CollectionFile[]} fileSpecs - array of collection file specifications objects
 * @throws {InvalidArgument} - If match is invalid, throws an error
 */
function validateMatch(match, bucketsConfig, fileName, fileSpecs) {
  const collectionRegexes = fileSpecs.map((spec) => spec.regex);
  if (match.length > 1) {
    throw new InvalidArgument(`File (${fileName}) matched more than one of ${JSON.stringify(collectionRegexes)}.`);
  }
  if (match.length === 0) {
    throw new InvalidArgument(`File (${fileName}) did not match any of ${JSON.stringify(collectionRegexes)}`);
  }
  if (!bucketsConfig.keyExists(match[0].bucket)) {
    throw new InvalidArgument(`Collection config specifies a bucket key of ${match[0].bucket}, `
      + `but the configured bucket keys are: ${Object.keys(bucketsConfig).join(', ')}`);
  }
}

/**
 * This function determines the final destinations for granule files and updates
 * their metadata accordingly, applying URL templates and setting appropriate buckets.
 *
 * @param {GranulesObject} granulesObject - an object of granules where the key is the granuleId
 * @param {Collection} collection - configuration object defining a collection of
 * granules and their files
 * @param {CmrFile[]} cmrFiles - array of objects that include CMR xmls uris and granuleIds
 * @param {BucketsConfig} bucketsConfig - instance associated with the stack
 * @returns {Promise<GranulesObject>} new granulesObject where each granules' files are updated with
 *                   the correct target buckets/paths/and s3uri filenames
 */
async function updateGranuleMetadata(granulesObject, collection, cmrFiles, bucketsConfig) {
  /** @type {GranulesObject} */
  const updatedGranules = {};
  const cmrFileNames = cmrFiles.map((f) => path.basename(f.key));
  const fileSpecs = collection.files;

  await Promise.all(Object.keys(granulesObject).map(async (granuleId) => {
    /** @type {MoveGranulesFileWithSourceKey[]} */
    const updatedFiles = [];
    updatedGranules[granuleId] = { ...granulesObject[granuleId] };

    const cmrFile = cmrFiles.find((f) => f.granuleId === granuleId);
    const cmrMetadata = cmrFile ? await metadataObjectFromCMRFile(`s3://${cmrFile.bucket}/${cmrFile.key}`) : {};

    granulesObject[granuleId].files.forEach((file) => {
      const cmrFileTypeObject = {};
      const fileName = path.basename(file.key);
      if (cmrFileNames.includes(fileName) && !file.type) {
        cmrFileTypeObject.type = 'metadata';
      }

      const match = fileSpecs.filter((cf) => unversionFilename(fileName).match(cf.regex));
      validateMatch(match, bucketsConfig, fileName, fileSpecs);

      const URLPathTemplate = match[0].url_path || collection.url_path || '';
      const urlPath = urlPathTemplate(URLPathTemplate, {
        file,
        granule: granulesObject[granuleId],
        cmrMetadata,
      });
      const bucketName = bucketsConfig.nameByKey(match[0].bucket);
      const updatedKey = S3.s3Join(urlPath, fileName);

      updatedFiles.push({
        ...file,
        ...cmrFileTypeObject, // Add type if the file is a CMR file
        bucket: bucketName,
        sourceKey: file.key,
        key: updatedKey,
      });
    });
    updatedGranules[granuleId].files = [...updatedFiles];
  }));
  return updatedGranules;
}

/**
 * Handles errors from the file lookup API call during cross-collection check.
 *
 * @param {unknown} error - The error thrown by the API call
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 key
 * @param {boolean} crossCollectionThrowOnObjectNotFound - Whether to throw on 404 errors
 * @throws {FileNotFound|Error} Throws appropriate error based on status code and configuration
 * @returns {boolean} Returns true if the error was a 404 that should be ignored
 */
function _handleFileNotFoundError(error, bucket, key, crossCollectionThrowOnObjectNotFound) {
  if (!error || !isObject(error) || !('statusCode' in error)) {
    throw error;
  }
  if (error.statusCode === HTTP_NOT_FOUND) {
    if (crossCollectionThrowOnObjectNotFound) {
      throw new FileNotFound(
        `File ${key} in bucket ${bucket} does not exist in the Cumulus database`
      );
    }

    log.debug(
      `File ${key} in bucket ${bucket} does not exist in the Cumulus database but exists in the filesystem. `
      + 'Ignoring orphan due to MoveGranules configuration.'
    );
    return true;
  }
  throw error;
}

/**
 * Checks if there is a collision between collections for the given file.
 *
 * @param {string} collectionId - Collection ID from the database
 * @param {string} granuleCollectionId - Expected collection ID
 * @param {string} granuleId - Granule ID from the database
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 key
 * @throws {InvalidArgument} If a cross-collection collision is detected
 */
function _checkForCollision(collectionId, granuleCollectionId, granuleId, bucket, key) {
  const collectionsDiffer = !collectionId || (collectionId !== granuleCollectionId);

  if (collectionsDiffer) {
    log.error('Cross-collection collision detected');
    log.error(
      `File ${key} in bucket ${bucket} is associated with granuleId ${granuleId}, collection ${collectionId}`
    );

    throw new InvalidArgument(
      `File already exists in bucket ${bucket} with key ${key} `
      + `for collection ${collectionId} and granuleId: ${granuleId}, `
      + `but is being moved for collection ${granuleCollectionId}.`
    );
  }
}

/**
 * Checks for cross-collection collisions for a given file.
 *
 * This function retrieves the granule and collection information associated
 * with a file identified by its S3 `bucket` and `key`. If the file is already
 * associated with a collection and that collection ID is different from the
 * provided `granuleCollectionId`, it throws an `InvalidArgument` error,
 * indicating a cross-collection collision.
 *
 * @param {object} params - The parameters for the collision check
 * @param {string} params.bucket - The S3 bucket name where the file is located
 * @param {string} params.key - The S3 key (path) of the file
 * @param {string} params.granuleCollectionId - The ID of the collection that the granule belongs to
 * @param {boolean} [params.crossCollectionThrowOnObjectNotFound=false] - Whether
 * to throw an error if the file is not found in the database
 * @param {number} [params.collectionCheckRetryCount=3] - Number of times to retry the
 * cross-collection-check database call
 * @param {Function} [params.getFileGranuleAndCollectionByBucketAndKeyMethod] - Direct
 * injection test mock for database method to get file granule and collection
 * @returns {Promise<void>} A Promise that resolves if no collision is detected
 * @throws {ValidationError|InvalidArgument|FileNotFound} Throws if validation fails
 * or a collision is detected
 */
async function _checkCrossCollectionCollisions({
  bucket,
  key,
  granuleCollectionId,
  getFileGranuleAndCollectionByBucketAndKeyMethod = getFileGranuleAndCollectionByBucketAndKey,
  collectionCheckRetryCount = 3,
  crossCollectionThrowOnObjectNotFound = false,
}) {
  let apiResponse;
  try {
    apiResponse = await getFileGranuleAndCollectionByBucketAndKeyMethod({
      pRetryOptions: { retries: collectionCheckRetryCount },
      bucket,
      key,
      prefix: getRequiredEnvVar('stackName'),
    });
  } catch (error) {
    const shouldReturnEarly = _handleFileNotFoundError(
      error,
      bucket,
      key,
      crossCollectionThrowOnObjectNotFound
    );
    if (shouldReturnEarly) {
      return;
    }
  }

  const { granuleId, collectionId } = JSON.parse(apiResponse.body);
  _checkForCollision(collectionId, granuleCollectionId, granuleId, bucket, key);

  log.debug(
    `File ${key} in bucket ${bucket} is not associated with a granule in a different collection. `
    + `${JSON.stringify(apiResponse)}`
  );
}

/**
 * Move file from source bucket to target location, and return the file moved.
 * In case of 'version' duplicateHandling, also return the renamed files.
 *
 * This function moves a single granule file from its source location to its target location,
 * handling duplicate files according to the specified duplicate handling strategy.
 *
 * @param {object} params - Move file parameters
 * @param {MoveGranulesFileWithSourceKey} params.file - granule file to be moved
 * @param {string} params.sourceBucket - source bucket location of files
 * @param {DuplicateHandling} params.duplicateHandling - how to handle duplicate files
 * @param {string} params.granuleCollectionId - Collection ID of the granule
 * @param {boolean} [params.markDuplicates=true] - Override to handle cmr
 * metadata files that shouldn't be marked as duplicates
 * @param {number} [params.s3MultipartChunksizeMb] - S3 multipart upload chunk
 * size in MB
 * @param {boolean} [params.checkCrossCollectionCollisions=true] - Whether to
 * check for cross-collection collisions
 * @param {number} [params.collectionCheckRetryCount=3] - Number of times to retry the
 * cross-collection-check database call
 * @param {boolean} [params.crossCollectionThrowOnObjectNotFound=false] - Whether to throw
 * an error if a file is not found in the database during cross-collection check
 * @param {object} [params.testOverrides={}] - Test overrides
 * @param {function} [params.testOverrides.getFileGranuleAndCollectionByBucketAndKeyMethod] -
 * Method to get file details
 * @returns {Promise<MoveGranulesFile[]>} returns the file moved and the renamed
 * existing duplicates if any
 */
async function moveFileRequest({
  file,
  sourceBucket,
  duplicateHandling,
  markDuplicates = true,
  s3MultipartChunksizeMb,
  checkCrossCollectionCollisions = true,
  collectionCheckRetryCount = 3,
  crossCollectionThrowOnObjectNotFound = false,
  granuleCollectionId,
  testOverrides = {},
}) {
  const source = {
    Bucket: sourceBucket,
    Key: file.sourceKey,
  };
  const target = {
    Bucket: file.bucket,
    Key: file.key,
  };

  // Due to S3's eventual consistency model, we need to make sure that the
  // source object is available in S3.
  await S3.waitForObjectToExist({ bucket: source.Bucket, key: source.Key });

  // the file moved to destination

  /** @type {MoveGranulesFile} */
  const fileMoved = { ...file };
  delete fileMoved.sourceKey;

  const s3ObjAlreadyExists = await S3.s3ObjectExists(target);
  log.debug(
    `file ${target.Key} exists in ${target.Bucket}: ${s3ObjAlreadyExists}`
  );

  let versionedFiles = [];
  if (s3ObjAlreadyExists) {
    // If there is a collision, per IART-924 we need to check if it's a cross
    // collection collision and fail in all cases if it is
    if (checkCrossCollectionCollisions) {
      await _checkCrossCollectionCollisions({
        bucket: target.Bucket,
        key: target.Key,
        granuleCollectionId,
        getFileGranuleAndCollectionByBucketAndKeyMethod:
          testOverrides.getFileGranuleAndCollectionByBucketAndKeyMethod ||
          getFileGranuleAndCollectionByBucketAndKey,
        collectionCheckRetryCount,
        crossCollectionThrowOnObjectNotFound,
      });
    }
    if (markDuplicates) fileMoved.duplicate_found = true;

    versionedFiles = await handleDuplicateFile({
      source,
      target,
      duplicateHandling,
    });
  } else {
    const chunkSize = s3MultipartChunksizeMb ? Number(s3MultipartChunksizeMb) * MB : undefined;
    await S3.moveObject({
      sourceBucket: source.Bucket,
      sourceKey: source.Key,
      destinationBucket: target.Bucket,
      destinationKey: target.Key,
      copyTags: true,
      chunkSize,
    });
  }

  const renamedFiles = versionedFiles.map((f) => ({
    bucket: f.Bucket,
    key: f.Key,
    size: f.size,
  }));

  // return both file moved and renamed files
  return [fileMoved, ...renamedFiles];
}

/**
 * Determines the collection ID for a granule based on granule metadata or config
 *
 * This function tries to construct a collection ID from either the granule's metadata
 * or from the collection configuration.
 *
 * @param {MoveGranulesGranule} granule - The granule object
 * @param {Collection} configCollection - The collection configuration
 * @returns {string|undefined} The collection ID if available
 */
function determineGranuleCollectionId(granule, configCollection) {
  if (granule.dataType && granule.version) {
    return constructCollectionId(granule.dataType, granule.version);
  }

  if (configCollection.name && configCollection.version) {
    return constructCollectionId(configCollection.name, configCollection.version);
  }

  return undefined;
}

/**
 * Process and move a list of files with given parameters
 *
 * This function processes a list of files and moves them to their target locations,
 * handling CMR files differently from regular files.
 *
 * @param {MoveGranulesFileWithSourceKey[]} files - List of files to move
 * @param {object} moveParams - Common parameters for moving files
 * @param {string} moveParams.sourceBucket - Source bucket location
 * @param {DuplicateHandling} [moveParams.duplicateHandling] - How to handle duplicates
 * @param {number} [moveParams.s3MultipartChunksizeMb] - Chunk size for multipart uploads
 * @param {boolean} [moveParams.checkCrossCollectionCollisions] - Whether to check
 * cross-collection collisions
 * @param {string} moveParams.granuleCollectionId - Collection ID
 * @param {number} [moveParams.collectionCheckRetryCount] - Number of times to retry the
 * cross-collection-check database call
 * @param {boolean} [moveParams.crossCollectionThrowOnObjectNotFound] - Whether to throw an error if
 * a file is not found in the database during cross-collection check
 * @param {object} [moveParams.testOverrides] - Test overrides
 * @param {boolean} [isCmrFile=false] - Whether these are CMR files
 * @returns {Promise<MoveGranulesFile[][]>} Moved files results
 * @throws {Error} If duplicateHandling is not provided for non-CMR files
 */
function processAndMoveFiles(files, moveParams, isCmrFile = false) {
  /** @type {DuplicateHandling} */
  let duplicateHandling;
  if (isCmrFile) {
    duplicateHandling = 'replace';
  } else {
    if (!moveParams.duplicateHandling) {
      throw new Error('duplicateHandling is required when processing non-CMR files');
    }
    duplicateHandling = moveParams.duplicateHandling;
  }

  if (!isCmrFile && !moveParams.duplicateHandling) {
    throw new Error('duplicateHandling is required when processing non-CMR files');
  }

  return Promise.all(
    files.map((file) =>
      moveFileRequest({
        ...moveParams,
        file,
        duplicateHandling,
        markDuplicates: !isCmrFile,
      }))
  );
}

/**
 * Move all files in a collection of granules from staging location to final location,
 * and update granule files to include renamed files if any.
 *
 * This function processes all the granules and moves their files to the target locations,
 * handling CMR files and regular files appropriately and updating granule metadata.
 *
 * @param {object} params - Move parameters
 * @param {Collection} params.configCollection - Collection configuration
 * @param {GranulesObject} params.granulesObject - an object of granules where key is granuleId
 * @param {string} params.sourceBucket - source bucket location of files
 * @param {DuplicateHandling} params.duplicateHandling - how to handle duplicate files
 * @param {number} [params.s3MultipartChunksizeMb] - S3 multipart upload chunk size in MB
 * @param {boolean} [params.checkCrossCollectionCollisions=true] - Whether to check
 * for cross-collection collisions
 * @param {number} [params.collectionCheckRetryCount=3] - Number of times to retry the
 * cross-collection-check database call
 * @param {boolean} [params.crossCollectionThrowOnObjectNotFound=false] - Whether
 * to throw an error if a file is not found in the database during cross-collection check
 * @param {object} [params.testOverrides={}] - Test overrides
 * @returns {Promise<GranulesObject>} the object with updated granules
 */
async function moveFilesForAllGranules({
  configCollection,
  granulesObject,
  sourceBucket,
  duplicateHandling,
  s3MultipartChunksizeMb,
  checkCrossCollectionCollisions = true,
  collectionCheckRetryCount = 3,
  crossCollectionThrowOnObjectNotFound = false,
  testOverrides = {},
}) {
  const moveFileRequests = Object.keys(granulesObject).map(async (granuleKey) => {
    const filesToMove = granulesObject[granuleKey].files.filter((file) => !isCMRFile(file));
    const cmrFiles = granulesObject[granuleKey].files.filter((file) => isCMRFile(file));

    const granuleCollectionId = determineGranuleCollectionId(
      granulesObject[granuleKey],
      configCollection
    );
    if (!granuleCollectionId) {
      throw new ValidationError(`Unable to determine collection ID for granule ${granuleKey}`);
    }

    /** @type {MoveGranulesGranuleOptionalFilesFields} */
    const granule = granulesObject[granuleKey];
    const commonMoveParams = {
      sourceBucket,
      checkCrossCollectionCollisions,
      collectionCheckRetryCount,
      crossCollectionThrowOnObjectNotFound,
      granuleCollectionId,
      testOverrides,
    };

    const filesMoved = await processAndMoveFiles(filesToMove, {
      ...commonMoveParams,
      duplicateHandling,
      s3MultipartChunksizeMb,
    });

    const cmrFilesMoved = await processAndMoveFiles(cmrFiles, commonMoveParams, true);

    granule.files = flatten(filesMoved).concat(flatten(cmrFilesMoved));
  });

  await Promise.all(moveFileRequests);
  return granulesObject;
}

/**
 * Move Granule files to final location.
 *
 * This function is the main entry point for the moveGranules task. It takes granules
 * from the input, updates their metadata based on collection configuration, and
 * moves their files to the target locations.
 *
 * @param {object} event - Lambda function payload
 * @param {object} event.config - the config object
 * @param {string} event.config.bucket - AWS S3 bucket that contains the granule files
 * @param {object} event.config.buckets - Buckets config
 * @param {string} event.config.distribution_endpoint - distribution endpoint for the api
 * @param {Collection} event.config.collection - collection configuration
 * @param {boolean} [event.config.moveStagedFiles=true] - set to false to skip moving files
 * @param {number} [event.config.s3MultipartChunksizeMb] - S3 multipart upload chunk size in MB
 * @param {boolean} [event.config.checkCrossCollectionCollisions=true] - Whether to check for
 * cross-collection collisions
 * @param {number} [event.config.collectionCheckRetryCount=3] - Number of times to retry the
 * cross-collection-check database call
 * @param {boolean} [event.config.crossCollectionThrowOnObjectNotFound=true] - Whether to throw
 * an error
 * if a file is not found in the database during cross-collection check
 * @param {object} event.input - a granules object containing an array of granules
 * @param {MoveGranulesGranule[]} event.input.granules - Array of granule objects
 * @param {object} [event.testOverrides] - Test overrides
 * @returns {Promise<{granuleDuplicates: Record<string, {files: MoveGranulesFile[]}>,
 * granules: MoveGranulesGranuleOptionalFilesFields[]}>}
 * Returns updated event object with moved granules and duplicate information
 */
async function moveGranules(event) {
  // We have to post the meta-xml file of all output granules
  const config = event.config;
  const bucketsConfig = new BucketsConfig(/** @type {BucketsConfigObject} */ (config.buckets));

  const moveStagedFiles = get(config, 'moveStagedFiles', true);
  const checkCrossCollectionCollisions = get(config, 'checkCrossCollectionCollisions', true);

  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : process.env.default_s3_multipart_chunksize_mb;

  const duplicateHandling = duplicateHandlingType(event);
  const granuleMetadataFileExtension = get(config, 'collection.meta.granuleMetadataFileExtension');

  log.debug(`moveGranules config duplicateHandling: ${duplicateHandling}, `
    + `moveStagedFiles: ${moveStagedFiles}, `
    + `s3MultipartChunksizeMb: ${s3MultipartChunksizeMb}, `
    + `granuleMetadataFileExtension ${granuleMetadataFileExtension}`);

  let filterFunc;
  if (granuleMetadataFileExtension) {
    filterFunc = /** @type {(fileobject: any) => boolean} */ (fileobject) =>
      isFileExtensionMatched(fileobject, granuleMetadataFileExtension);
  } else {
    filterFunc = /** @type {(fileobject: any) => boolean} */ (fileobject) =>
      isCMRFile(fileobject) || isISOFile(fileobject);
  }

  const granulesInput = event.input.granules;
  const cmrFiles = granulesToCmrFileObjects(granulesInput, filterFunc);
  const granulesByGranuleId = keyBy(granulesInput, 'granuleId');

  /** @type {GranulesOutputObject} */
  let movedGranulesByGranuleId;

  // allows us to disable moving the files
  if (moveStagedFiles) {
    // Update all granules with aspirational metadata (where the files should
    // end up after moving).
    const granulesToMove = await updateGranuleMetadata(
      granulesByGranuleId,
      config.collection,
      cmrFiles,
      bucketsConfig
    );

    // Move files from staging location to final location
    movedGranulesByGranuleId = await moveFilesForAllGranules({
      configCollection: config.collection,
      granulesObject: granulesToMove,
      sourceBucket: config.bucket,
      duplicateHandling,
      s3MultipartChunksizeMb: Number(s3MultipartChunksizeMb),
      checkCrossCollectionCollisions,
      collectionCheckRetryCount: config.collectionCheckRetryCount,
      crossCollectionThrowOnObjectNotFound: config.crossCollectionThrowOnObjectNotFound,
      testOverrides: get(event, 'testOverrides', {}),
    });
  } else {
    movedGranulesByGranuleId = granulesByGranuleId;
  }

  const granuleDuplicates = buildGranuleDuplicatesObject(
    movedGranulesByGranuleId
  );

  return {
    granuleDuplicates,
    granules: Object.values(movedGranulesByGranuleId),
  };
}

/**
 * Lambda handler
 *
 * This is the Lambda handler function that uses the Cumulus Message Adapter
 * to run the moveGranules task.
 *
 * @param {CumulusMessage} event - a Cumulus Message
 * @param {Context} context - an AWS Lambda context
 * @returns {Promise<object>} - Returns output from task.
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(moveGranules, event, context);
}

exports.handler = handler;
exports.moveGranules = moveGranules;
exports._checkCrossCollectionCollisions = _checkCrossCollectionCollisions;
exports.determineGranuleCollectionId = determineGranuleCollectionId;
