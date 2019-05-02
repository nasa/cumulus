'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { InvalidArgument } = require('@cumulus/common/errors');
const get = require('lodash.get');
const clonedeep = require('lodash.clonedeep');
const flatten = require('lodash.flatten');
const keyBy = require('lodash.keyby');
const path = require('path');

const {
  handleDuplicateFile,
  unversionFilename,
  moveGranuleFile,
  duplicateHandlingType
} = require('@cumulus/ingest/granule');

const {
  isCMRFile,
  metadataObjectFromCMRFile,
  granulesToCmrFileObjects,
  updateCMRMetadata
} = require('@cumulus/cmrjs');

const {
  aws: {
    buildS3Uri,
    s3ObjectExists
  },
  BucketsConfig
} = require('@cumulus/common');
const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');
const log = require('@cumulus/common/log');

/**
 * validates the file matched only one collection.file and has a valid bucket
 * config.
 * @param {Array<Object>} match - list of matched collection.file
 * @param {BucketsConfig} bucketsConfig - instance describing stack configuration.
 * @param {Object} file - the fileObject tested.
 * @throws {InvalidArgument} - If match is invalid, throws and error.
 */
function validateMatch(match, bucketsConfig, file) {
  if (match.length > 1) {
    throw new InvalidArgument(`File (${file}) matched more than one collection.regexp.`);
  }
  if (match.length === 0) {
    throw new InvalidArgument(`File (${file}) did not match any collection.regexp.`);
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
      validateMatch(match, bucketsConfig, file);

      const URLPathTemplate = file.url_path || match[0].url_path || collection.url_path || '';
      const urlPath = urlPathTemplate(URLPathTemplate, {
        file,
        granule: granulesObject[granuleId],
        cmrMetadata
      });
      const bucketName = bucketsConfig.nameByKey(match[0].bucket);
      const filepath = path.join(urlPath, file.name);

      updatedFiles.push({
        ...file, // keeps old info like "name" and "fileStagingDir"
        ...cmrFileTypeObject, // Add type if the file is a CMR file
        ...{
          bucket: bucketName,
          filepath,
          filename: `s3://${path.join(bucketName, filepath)}`,
          url_path: URLPathTemplate
        }
      });
    });
    updatedGranules[granuleId].files = [...updatedFiles];
  }));
  return updatedGranules;
}

/**
 * move file from source bucket to target location, and return the file moved.
 * In case of 'version' duplicateHandling, also return the renamed files.
 *
 * @param {Object} file - granule file to be moved
 * @param {string} sourceBucket - source bucket location of files
 * @param {string} duplicateHandling - how to handle duplicate files
 * @param {BucketsConfig} bucketsConfig - BucketsConfig instance
 * @param {boolean} markDuplicates - Override to handle cmr metadata files that
                                     shouldn't be marked as duplicates
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
    Key: `${fileStagingDir}/${file.name}`
  };
  const target = {
    Bucket: file.bucket,
    Key: file.filepath
  };

  // the file moved to destination
  const fileMoved = clonedeep(file);
  delete fileMoved.fileStagingDir;

  const s3ObjAlreadyExists = await s3ObjectExists(target);
  log.debug(`file ${target.Key} exists in ${target.Bucket}: ${s3ObjAlreadyExists}`);

  const options = (bucketsConfig.type(file.bucket).match('public')) ? { ACL: 'public-read' } : null;
  let versionedFiles = [];
  if (s3ObjAlreadyExists) {
    if (markDuplicates) fileMoved.duplicate_found = true;
    // returns renamed files for 'version', otherwise empty array
    versionedFiles = await handleDuplicateFile({
      source,
      target,
      copyOptions: options,
      duplicateHandling
    });
  } else {
    await moveGranuleFile(source, target, options);
  }

  // return both file moved and renamed files
  return [fileMoved]
    .concat(versionedFiles.map((f) => ({
      bucket: f.Bucket,
      name: path.basename(f.Key),
      filename: buildS3Uri(f.Bucket, f.Key),
      filepath: f.Key,
      size: f.size,
      url_path: file.url_path
    })));
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
 **/
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
 * Update each of the CMR files' OnlineAccessURL fields to represent the new
 * file locations.
 *
 * @param {Array<Object>} cmrFiles - array of objects that include CMR xmls uris and granuleIds
 * @param {Object} granulesObject - an object of the granules where the key is the granuleId
 * @param {string} distEndpoint - the api distribution endpoint
 * @param {BucketsConfig} bucketsConfig - BucketsConfig instance
 * @returns {Promise} promise resolves when all files have been updated
 **/
async function updateEachCmrFileAccessURLs(
  cmrFiles,
  granulesObject,
  distEndpoint,
  bucketsConfig
) {
  return Promise.all(cmrFiles.map(async (cmrFile) => {
    const publish = false; // Do the publish in publish-to-cmr step
    const granuleId = cmrFile.granuleId;
    const granule = granulesObject[granuleId];
    const updatedCmrFile = granule.files.find(isCMRFile);
    return updateCMRMetadata({
      granuleId,
      cmrFile: updatedCmrFile,
      files: granule.files,
      distEndpoint,
      publish,
      inBuckets: bucketsConfig
    });
  }));
}

/**
 * Move Granule files to final Location
 * See the schemas directory for detailed input and output schemas
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
 * @returns {Promise} returns the promise of an updated event object
 */
async function moveGranules(event) {
  // we have to post the meta-xml file of all output granules
  // first we check if there is an output file
  const config = event.config;
  const bucketsConfig = new BucketsConfig(config.buckets);
  const moveStagedFiles = get(config, 'moveStagedFiles', true);

  const duplicateHandling = duplicateHandlingType(event);

  const granulesInput = event.input.granules;
  const cmrFiles = granulesToCmrFileObjects(granulesInput);
  const granulesByGranuleId = keyBy(granulesInput, 'granuleId');

  let movedGranules;
  // allows us to disable moving the files
  if (moveStagedFiles) {
    // update allGranules with aspirational metadata (where the file should end up after moving.)
    const granulesToMove = await updateGranuleMetadata(
      granulesByGranuleId, config.collection, cmrFiles, bucketsConfig
    );

    // move files from staging location to final location
    movedGranules = await moveFilesForAllGranules(
      granulesToMove, config.bucket, duplicateHandling, bucketsConfig
    );
    // update cmr metadata files with correct online access urls
    await updateEachCmrFileAccessURLs(
      cmrFiles,
      movedGranules,
      config.distribution_endpoint,
      bucketsConfig
    );
  } else {
    movedGranules = granulesByGranuleId;
  }

  return {
    granules: Object.keys(movedGranules).map((k) => movedGranules[k])
  };
}
exports.moveGranules = moveGranules;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(moveGranules, event, context, callback);
}

exports.handler = handler;
