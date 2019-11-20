'use strict';

const fs = require('fs-extra');
const {
  aws: { buildS3Uri, parseS3Uri, s3 },
  stringUtils: { replace },
  testUtils: { randomStringFromRegex }
} = require('@cumulus/common');
const { thread } = require('@cumulus/common/util');
const path = require('path');
const cloneDeep = require('lodash.clonedeep');

/**
 * Adds updated url_path to a granule's files object.
 *
 * @param  {Array<Object>} files - array of granule files
 * @param  {string} testId - Test ID to insert into url_path per-granule
 * @param  {string} collectionUrlPath - collection
 * @returns {Array<Object>} deep copy of the specified files where each file's
 *    `url_path` property (which, if undefined, defaults to the specified
 *    collection URL path) is appended with a slash, the specified test ID, and
 *    a trailing slash
 */
const addUrlPathToGranuleFiles = (files, testId, collectionUrlPath) =>
  files.map((file) => {
    const updatedUrlPath = file.url_path === undefined ?
      collectionUrlPath :
      `${file.url_path}/`;

    return {
      ...file,
      url_path: `${updatedUrlPath}${testId}/`
    };
  });

/**
 * Add test-unique filepath to granule file filepath/filenames.
 *
 * @param  {Array<Object>} granules - Array of granules with files to be updated
 * @param  {string} filePath - Filepath to add
 * @returns {Array<Object>} deep copy of the specified granules with the
 *    specified file path inserted immediately preceding the last part of the
 *    path of each file of each granule
 */
const addUniqueGranuleFilePathToGranuleFiles = (granules, filePath) =>
  granules.map((originalGranule) => {
    const granule = cloneDeep(originalGranule);

    granule.files.forEach((file) => {
      const { Bucket, Key } = parseS3Uri(file.filename);
      const { dir, base } = path.parse(Key);
      const updateKey = `${dir}/${filePath}/${base}`;

      Object.assign(file, {
        filename: buildS3Uri(Bucket, updateKey),
        filepath: updateKey
      });
    });

    return granule;
  });

/**
 * Create test granule files by copying current granule files and renaming
 * with new granule id
 *
 * @param {Array<Object>} granuleFiles - array of granule file object
 * @param {string} bucket - source/destination bucket
 * @param {string} oldGranuleId - granule id of files to copy
 * @param {string} newGranuleId - new granule id
 * @returns {Promise<Array>} - AWS S3 copyObject responses
 */
function createGranuleFiles(granuleFiles, bucket, oldGranuleId, newGranuleId) {
  const copyFile = (file) =>
    s3().copyObject({
      Bucket: bucket,
      CopySource: `${bucket}/${file.path}/${file.name}`,
      Key: `${file.path}/${file.name.replace(oldGranuleId, newGranuleId)}`
    }).promise()
      .catch((err) => {
        console.error(`Failed to copy s3://${bucket}/${file.path}/${file.name} to s3://${bucket}/${file.path}/${file.name.replace(oldGranuleId, newGranuleId)}: ${err.message}`);
        throw err;
      });

  return Promise.all(granuleFiles.map(copyFile));
}

/**
 * Set up files in the S3 data location for a new granule to use for this
 * test. Use the input payload to determine which files are needed and
 * return updated input with the new granule id.
 *
 * @param {string} bucket - data bucket
 * @param {string} inputPayloadJson - input payload as a JSON string
 * @param {string} granuleRegex - regex to generate the new granule id
 * @param {string} testSuffix - suffix for test-specific collection
 * @param {string} testDataFolder - test data S3 path
 * @returns {Promise<Object>} - input payload as a JS object with the updated granule ids
 */
async function setupTestGranuleForIngest(bucket, inputPayloadJson, granuleRegex, testSuffix = '', testDataFolder = null) {
  let payloadJson;

  if (testDataFolder) {
    payloadJson = replace(
      new RegExp('cumulus-test-data/pdrs', 'g'),
      testDataFolder,
      inputPayloadJson
    );
  } else {
    payloadJson = inputPayloadJson;
  }

  const baseInputPayload = JSON.parse(payloadJson);

  const oldGranuleId = baseInputPayload.granules[0].granuleId;
  baseInputPayload.granules[0].dataType += testSuffix;

  const newGranuleId = randomStringFromRegex(granuleRegex);
  if (baseInputPayload.pdr && baseInputPayload.pdr.name) {
    baseInputPayload.pdr.name += testSuffix;
  }

  await createGranuleFiles(
    baseInputPayload.granules[0].files,
    bucket,
    oldGranuleId,
    newGranuleId
  );

  return thread(
    baseInputPayload,
    JSON.stringify,
    replace(new RegExp(oldGranuleId, 'g'), newGranuleId),
    JSON.parse
  );
}

/**
 * Read the file, update it with the new granule id, path, collectionId, and
 * stackId, and return the file as a JS object.
 *
 * @param {string} filename - file path
 * @param {string} newGranuleId - new granule id
 * @param {string} newPath - the new data path
 * @param {string} newCollectionId - the new collection id
 * @param {stackId} stackId - the new stack id
 * @returns {Promise<Object>} - file as a JS object
 */
const loadFileWithUpdatedGranuleIdPathAndCollection = (
  filename,
  newGranuleId,
  newPath,
  newCollectionId,
  stackId
) => thread(
  fs.readFileSync(filename, 'utf8'),
  replace(new RegExp('replace-me-granuleId', 'g'), newGranuleId),
  replace(new RegExp('replace-me-path', 'g'), newPath),
  replace(new RegExp('replace-me-collectionId', 'g'), newCollectionId),
  replace(new RegExp('replace-me-stackId', 'g'), stackId),
  JSON.parse
);

module.exports = {
  addUniqueGranuleFilePathToGranuleFiles,
  addUrlPathToGranuleFiles,
  loadFileWithUpdatedGranuleIdPathAndCollection,
  setupTestGranuleForIngest
};
