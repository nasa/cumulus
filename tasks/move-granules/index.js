'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

const get = require('lodash/get');
const flatten = require('lodash/flatten');
const keyBy = require('lodash/keyBy');
const path = require('path');

const {
  buildS3Uri,
  moveObject,
  s3Join,
  s3ObjectExists,
  waitForObjectToExist,
} = require('@cumulus/aws-client/S3');

const { InvalidArgument } = require('@cumulus/errors');

const {
  handleDuplicateFile,
  unversionFilename,
  duplicateHandlingType,
} = require('@cumulus/ingest/granule');

const {
  isCMRFile,
  metadataObjectFromCMRFile,
  granulesToCmrFileObjects,
} = require('@cumulus/cmrjs');

const BucketsConfig = require('@cumulus/common/BucketsConfig');

const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');
const log = require('@cumulus/common/log');

/**
 * Validates the file matched only one collection.file and has a valid bucket
 * config.
 *
 * @param {Array<Object>} match - list of matched collection.file.
 * @param {BucketsConfig} bucketsConfig - instance describing stack configuration.
 * @param {Object} fileName - the file name tested.
 * @param {Array<Object>} fileSpecs - array of collection file specifications objects.
 * @throws {InvalidArgument} - If match is invalid, throws an error.
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
 * Update the granule metadata where each granule has its files replaced with
 * file objects that contain the desired final locations based on the
 * `collection.files.regexp`.  CMR metadata files have a file type added.
 *
 * @param {Object} granulesObject - an object of granules where the key is the granuleId
 * @param {Object} collection - configuration object defining a collection
 *                              of granules and their files
 * @param {Array<Object>} cmrFiles - array of objects that include CMR xmls uris and granuleIds
 * @param {BucketsConfig} bucketsConfig -  instance associated with the stack
 * @returns {Object} new granulesObject where each granules' files are updated with
 *                   the correct target buckets/paths/and s3uri filenames.
 */
async function updateGranuleMetadata(granulesObject, collection, cmrFiles, bucketsConfig) {
  const updatedGranules = {};
  const cmrFileNames = cmrFiles.map((f) => path.basename(f.filename));
  const fileSpecs = collection.files;

  await Promise.all(Object.keys(granulesObject).map(async (granuleId) => {
    const updatedFiles = [];
    updatedGranules[granuleId] = { ...granulesObject[granuleId] };

    const cmrFile = cmrFiles.find((f) => f.granuleId === granuleId);
    const cmrMetadata = cmrFile ? await metadataObjectFromCMRFile(cmrFile.filename) : {};

    granulesObject[granuleId].files.forEach((file) => {
      const cmrFileTypeObject = {};
      if (cmrFileNames.includes(file.name) && !file.type) {
        cmrFileTypeObject.type = 'metadata';
      }

      const match = fileSpecs.filter((cf) => unversionFilename(file.name).match(cf.regex));
      validateMatch(match, bucketsConfig, file.name, fileSpecs);

      const URLPathTemplate = file.url_path || match[0].url_path || collection.url_path || '';
      const urlPath = urlPathTemplate(URLPathTemplate, {
        file,
        granule: granulesObject[granuleId],
        cmrMetadata,
      });
      const bucketName = bucketsConfig.nameByKey(match[0].bucket);
      const filepath = s3Join(urlPath, file.name);

      updatedFiles.push({
        ...file, // keeps old info like "name" and "fileStagingDir"
        ...cmrFileTypeObject, // Add type if the file is a CMR file
        ...{
          bucket: bucketName,
          filepath,
          filename: `s3://${s3Join(bucketName, filepath)}`,
          url_path: URLPathTemplate,
        },
      });
    });
    updatedGranules[granuleId].files = [...updatedFiles];
  }));
  return updatedGranules;
}

/**
 * Move file from source bucket to target location, and return the file moved.
 * In case of 'version' duplicateHandling, also return the renamed files.
 *
 * @param {Object} file - granule file to be moved
 * @param {string} sourceBucket - source bucket location of files
 * @param {string} duplicateHandling - how to handle duplicate files
 * @param {BucketsConfig} bucketsConfig - BucketsConfig instance
 * @param {boolean} markDuplicates - Override to handle cmr metadata files that
 *                                   shouldn't be marked as duplicates
 * @returns {Array<Object>} returns the file moved and the renamed existing duplicates if any
 */
async function moveFileRequest(
  file,
  sourceBucket,
  duplicateHandling,
  bucketsConfig,
  markDuplicates = true
) {
  const fileStagingDir = file.fileStagingDir || 'file-staging';
  const source = {
    Bucket: sourceBucket,
    Key: `${fileStagingDir}/${file.name}`,
  };
  const target = {
    Bucket: file.bucket,
    Key: file.filepath,
  };

  // Due to S3's eventual consistency model, we need to make sure that the
  // source object is available in S3.
  await waitForObjectToExist({ bucket: source.Bucket, key: source.Key });

  // the file moved to destination
  const fileMoved = { ...file };
  delete fileMoved.fileStagingDir;

  const s3ObjAlreadyExists = await s3ObjectExists(target);
  log.debug(`file ${target.Key} exists in ${target.Bucket}: ${s3ObjAlreadyExists}`);

  let versionedFiles = [];
  if (s3ObjAlreadyExists) {
    if (markDuplicates) fileMoved.duplicate_found = true;
    // returns renamed files for 'version', otherwise empty array
    versionedFiles = await handleDuplicateFile({
      source,
      target,
      duplicateHandling,
    });
  } else {
    await moveObject({
      sourceBucket: source.Bucket,
      sourceKey: source.Key,
      destinationBucket: target.Bucket,
      destinationKey: target.Key,
      copyTags: true,
    });
  }

  const renamedFiles = versionedFiles.map((f) => ({
    bucket: f.Bucket,
    name: path.basename(f.Key),
    filename: buildS3Uri(f.Bucket, f.Key),
    filepath: f.Key,
    size: f.size,
    url_path: file.url_path,
  }));

  // return both file moved and renamed files
  return [fileMoved, ...renamedFiles];
}

/**
 * Move all files in a collection of granules from staging location fo final location,
 * and update granule files to include renamed files if any.
 *
 * @param {Object} granulesObject - an object of the granules where the key is the granuleId
 * @param {string} sourceBucket - source bucket location of files
 * @param {string} duplicateHandling - how to handle duplicate files
 * @param {BucketsConfig} bucketsConfig - BucketsConfig instance
 * @returns {Object} the object with updated granules
 */
async function moveFilesForAllGranules(
  granulesObject,
  sourceBucket,
  duplicateHandling,
  bucketsConfig
) {
  const moveFileRequests = Object.keys(granulesObject).map(async (granuleKey) => {
    const granule = granulesObject[granuleKey];
    const filesToMove = granule.files.filter((file) => !isCMRFile(file));
    const cmrFiles = granule.files.filter((file) => isCMRFile(file));
    const filesMoved = await Promise.all(
      filesToMove.map(
        (file) => moveFileRequest(file, sourceBucket, duplicateHandling, bucketsConfig)
      )
    );
    const markDuplicates = false;
    const cmrFilesMoved = await Promise.all(
      cmrFiles.map(
        (file) => moveFileRequest(file, sourceBucket, 'replace', bucketsConfig, markDuplicates)
      )
    );
    granule.files = flatten(filesMoved).concat(flatten(cmrFilesMoved));
  });

  await Promise.all(moveFileRequests);
  return granulesObject;
}

/**
 * Move Granule files to final location.
 * See the schemas directory for detailed input and output schemas.
 *
 * @param {Object} event - Lambda function payload
 * @param {Object} event.config - the config object
 * @param {string} event.config.bucket - Bucket name where public/private keys are stored
 * @param {Object} event.config.buckets - Buckets config
 * @param {string} event.config.distribution_endpoint - distribution endpoint for the api
 * @param {Object} event.config.collection - collection configuration
 *                     https://nasa.github.io/cumulus/docs/data-cookbooks/setup#collections
 * @param {boolean} [event.config.moveStagedFiles=true] - set to false to skip moving files
 *                                 from staging to final bucket. Mostly useful for testing.
 * @param {Object} event.input - a granules object containing an array of granules
 *
 * @returns {Promise} returns the promise of an updated event object
 */
async function moveGranules(event) {
  // We have to post the meta-xml file of all output granules
  const config = event.config;
  const bucketsConfig = new BucketsConfig(config.buckets);

  const moveStagedFiles = get(config, 'moveStagedFiles', true);

  const duplicateHandling = duplicateHandlingType(event);

  const granulesInput = event.input.granules;
  const cmrFiles = granulesToCmrFileObjects(granulesInput);
  const granulesByGranuleId = keyBy(granulesInput, 'granuleId');

  let movedGranulesByGranuleId;

  // allows us to disable moving the files
  if (moveStagedFiles) {
    // Update all granules with aspirational metadata (where the files should
    // end up after moving).
    const granulesToMove = await updateGranuleMetadata(
      granulesByGranuleId, config.collection, cmrFiles, bucketsConfig
    );

    // Move files from staging location to final location
    movedGranulesByGranuleId = await moveFilesForAllGranules(
      granulesToMove, config.bucket, duplicateHandling, bucketsConfig
    );
  } else {
    movedGranulesByGranuleId = granulesByGranuleId;
  }

  return {
    granules: Object.values(movedGranulesByGranuleId),
  };
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return cumulusMessageAdapter.runCumulusTask(moveGranules, event, context);
}

exports.handler = handler;
exports.moveGranules = moveGranules;
