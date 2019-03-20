'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { DuplicateFile, InvalidArgument } = require('@cumulus/common/errors');
const get = require('lodash.get');
const clonedeep = require('lodash.clonedeep');
const flatten = require('lodash.flatten');
const path = require('path');

const {
  getRenamedS3File,
  unversionFilename,
  moveGranuleFile,
  renameS3FileWithTimestamp,
  duplicateHandlingType
} = require('@cumulus/ingest/granule');

const {
  getCmrFiles,
  getGranuleId,
  isCMRFile,
  metadataObjectFromCMRFile,
  updateCMRMetadata
} = require('@cumulus/cmrjs');

const {
  aws: {
    buildS3Uri,
    calculateS3ObjectChecksum,
    deleteS3Object,
    parseS3Uri,
    s3ObjectExists
  },
  BucketsConfig
} = require('@cumulus/common');
const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');
const log = require('@cumulus/common/log');


/**
 * Helper to turn an s3URI into a fileobject
 * @param {string} s3URI s3://mybucket/myprefix/myobject.
 * @returns {Object} file object
 */
function fileObjectFromS3URI(s3URI) {
  const uriParsed = parseS3Uri(s3URI);
  return {
    name: path.basename(s3URI),
    bucket: uriParsed.Bucket,
    filename: s3URI,
    fileStagingDir: path.dirname(uriParsed.Key)
  };
}

/**
 * Takes the files from input and granules and merges them into an object where
 * each file is associated with it's granuleId.
 *
 * @param {Array} inputFiles - list of s3 files to add to the inputgranules
 * @param {Array} inputGranules - an array of the granules
 * @param {string} regex - regex needed to extract granuleId from filenames
 * @returns {Object} an object that contains lists of each granules' files
 *                   attatched by their granuleId
 */
function mergeInputFilesWithInputGranules(inputFiles, inputGranules, regex) {
  const granulesHash = {};
  const filesFromInputGranules = {};

  // create hash list of the granules
  // and a hash list of files
  inputGranules.forEach((g) => {
    granulesHash[g.granuleId] = g;
    g.files.forEach((f) => {
      filesFromInputGranules[f.filename] = g.granuleId;
    });
  });

  // add input files to corresponding granules
  // the process involve getting granuleId of each file
  // match it against the granuleObj and adding the new files to the
  // file list
  inputFiles.forEach((f) => {
    if (f && !filesFromInputGranules[f]) {
      const granuleId = getGranuleId(f, regex);
      granulesHash[granuleId].files.push(fileObjectFromS3URI(f));
    }
  });

  return granulesHash;
}

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
 * `collection.files.regexp`.  CMR metadata files have a fileType added.
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
  const cmrFileNames = cmrFiles.map((f) => fileObjectFromS3URI(f.filename).name);
  const fileSpecs = collection.files;

  await Promise.all(Object.keys(granulesObject).map(async (granuleId) => {
    const updatedFiles = [];
    updatedGranules[granuleId] = { ...granulesObject[granuleId] };

    const cmrFile = cmrFiles.find((f) => f.granuleId === granuleId);
    const cmrMetadata = cmrFile ? await metadataObjectFromCMRFile(cmrFile.filename) : {};

    granulesObject[granuleId].files.forEach((file) => {
      const cmrFileTypeObject = {};
      if (cmrFileNames.includes(file.name) && !file.fileType) {
        cmrFileTypeObject.fileType = 'metadata';
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
        ...cmrFileTypeObject, // Add fileType if the file is a CMR file
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

  if (s3ObjAlreadyExists && markDuplicates) fileMoved.duplicate_found = true;

  // Have to throw DuplicateFile and not WorkflowError, because the latter
  // is not treated as a failure by the message adapter.
  if (s3ObjAlreadyExists && duplicateHandling === 'error') {
    throw new DuplicateFile(`${target.Key} already exists in ${target.Bucket} bucket`);
  }

  if (s3ObjAlreadyExists && duplicateHandling === 'skip') return [fileMoved];

  const options = (bucketsConfig.type(file.bucket).match('public')) ? { ACL: 'public-read' } : null;

  // compare the checksum of the existing file and new file, and handle them accordingly
  if (s3ObjAlreadyExists && duplicateHandling === 'version') {
    const existingFileSum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket: target.Bucket, key: target.Key });
    const stagedFileSum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket: source.Bucket, key: source.Key });

    // if the checksum of the existing file is the same as the new one, keep the existing file,
    // else rename the existing file, and both files are part of the granule.
    if (existingFileSum === stagedFileSum) {
      await deleteS3Object(source.Bucket, source.Key);
    }
    else {
      await renameS3FileWithTimestamp(target.Bucket, target.Key);
      await moveGranuleFile(source, target, options);
    }
  }
  else {
    await moveGranuleFile(source, target, options);
  }

  const renamedFiles = (duplicateHandling === 'version')
    ? await getRenamedS3File(target.Bucket, target.Key)
    : [];

  // return both file moved and renamed files
  return [fileMoved]
    .concat(renamedFiles.map((f) => ({
      bucket: f.Bucket,
      name: path.basename(f.Key),
      filename: buildS3Uri(f.Bucket, f.Key),
      filepath: f.Key,
      fileSize: f.fileSize,
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
 * @param {string} event.config.granuleIdExtraction - regex needed to extract granuleId
 *                                                    from filenames
 * @param {Array} event.config.input_granules - an array of granules
 * @param {string} event.config.distribution_endpoint - distribution endpoint for the api
 * @param {Object} event.config.collection - collection configuration
 *                     https://nasa.github.io/cumulus/docs/data-cookbooks/setup#collections
 * @param {boolean} [event.config.moveStagedFiles=true] - set to false to skip moving files
 *                                 from staging to final bucket. Mostly useful for testing.
 * @param {Array} event.input - an array of s3 uris
 * @returns {Promise} returns the promise of an updated event object
 */
async function moveGranules(event) {
  // we have to post the meta-xml file of all output granules
  // first we check if there is an output file
  const config = get(event, 'config');
  const sourceBucket = get(config, 'bucket'); // the name of the bucket with staged data.
  const bucketsConfig = new BucketsConfig(get(config, 'buckets'));
  const granuleIdExtractionRegex = get(config, 'granuleIdExtraction', '(.*)');
  const inputGranules = get(config, 'input_granules', {});
  const distEndpoint = get(config, 'distribution_endpoint');
  const moveStagedFiles = get(config, 'moveStagedFiles', true);
  const collection = config.collection;

  const duplicateHandling = duplicateHandlingType(event);

  const inputFileList = get(event, 'input', []);

  // Get list of cmr file objects from the input Array of S3 filenames (in
  // staging location after processing)
  const cmrFiles = getCmrFiles(inputFileList, granuleIdExtractionRegex);

  const allGranules = mergeInputFilesWithInputGranules(
    inputFileList, inputGranules, granuleIdExtractionRegex
  );

  let granulesToMove;
  let movedGranules;
  // allows us to disable moving the files
  if (moveStagedFiles) {
    // update allGranules with aspirational metadata (where the file should end up after moving.)
    granulesToMove = await updateGranuleMetadata(allGranules, collection, cmrFiles, bucketsConfig);

    // move files from staging location to final location
    movedGranules = await moveFilesForAllGranules(
      granulesToMove, sourceBucket, duplicateHandling, bucketsConfig
    );
    // update cmr metadata files with correct online access urls
    await updateEachCmrFileAccessURLs(
      cmrFiles,
      movedGranules,
      distEndpoint,
      bucketsConfig
    );
  }
  else {
    movedGranules = allGranules;
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
