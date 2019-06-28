'use strict';

const fs = require('fs-extra');
const {
  aws: { buildS3Uri, parseS3Uri, s3 },
  stringUtils: { globalReplace },
  testUtils: { randomStringFromRegex }
} = require('@cumulus/common');
const path = require('path');
const cloneDeep = require('lodash.clonedeep');

/**
 * Adds updated url_path to a granule files object
 *
 * @param  {Array<object>} files - array of granule files
 * @param  {string} testId - Test ID to insert into url_path per-granule
 * @param  {string} collectionUrlPath - collection
 */
function addUrlPathToGranuleFiles(files, testId, collectionUrlPath) {
  const updatedFiles = cloneDeep(files);
  return updatedFiles.map((file) => {
    const fileUpdate = cloneDeep(file);
    const updatedUrlPath = Object.is(file.url_path, undefined) ? collectionUrlPath : `${file.url_path}/`;
    fileUpdate.url_path = `${updatedUrlPath}${testId}/`;
    return fileUpdate;
  });
}

/**
 * Add test-unique filepath to granule file filepath/filenames
 *
 * @param  {Array<Object>} granules - Array of granules with files to be updated
 * @param  {string} filePath - Filepath to add
 */
function addUniqueGranuleFilePathToGranuleFiles(granules, filePath) {
  const updatedGranules = granules.map((originalGranule) => {
    const granule = cloneDeep(originalGranule);
    granule.files = granule.files.map((file) => {
      const { Bucket, Key } = parseS3Uri(file.filename);
      const { base, dir } = path.parse(Key);
      const updateKey = `${dir}/${filePath}/${base}`;
      const filename = buildS3Uri(Bucket, updateKey);
      file.filename = filename; //eslint-disable-line no-param-reassign
      file.filepath = updateKey; //eslint-disable-line no-param-reassign
      return file;
    });
    return granule;
  });
  return updatedGranules;
}

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
  // granule id for the new files
  const newGranuleId = randomStringFromRegex(granuleRegex);
  console.log(`\ngranule id: ${newGranuleId}`);

  if (testDataFolder) inputPayloadJson = globalReplace(inputPayloadJson, 'cumulus-test-data/pdrs', testDataFolder); //eslint-disable-line no-param-reassign
  const baseInputPayload = JSON.parse(inputPayloadJson);
  const oldGranuleId = baseInputPayload.granules[0].granuleId;
  baseInputPayload.granules[0].dataType += testSuffix;

  await createGranuleFiles(
    baseInputPayload.granules[0].files,
    bucket,
    oldGranuleId,
    newGranuleId
  );

  const baseInputPayloadJson = JSON.stringify(baseInputPayload);
  const updatedInputPayloadJson = globalReplace(baseInputPayloadJson, oldGranuleId, newGranuleId);

  return JSON.parse(updatedInputPayloadJson);
}

/**
 * Read the file, update it with the new granule id, path and collectionId,
 * and return the file as a JS object.
 *
 * @param {string} file - file path
 * @param {string} newGranuleId - new granule id
 * @param {string} newPath - the new data path
 * @param {string} newCollectionId - the new collection id
 * @returns {Promise<Object>} - file as a JS object
 */
function loadFileWithUpdatedGranuleIdPathAndCollection(file, newGranuleId, newPath, newCollectionId) {
  const fileContents = fs.readFileSync(file, 'utf8');
  const fileContentsWithId = globalReplace(fileContents, 'replace-me-granuleId', newGranuleId);
  const fileContentsWithIdAndPath = globalReplace(fileContentsWithId, 'replace-me-path', newPath);
  const fileContentsWithIdPathAndCollection = globalReplace(fileContentsWithIdAndPath, 'replace-me-collectionId', newCollectionId);
  return JSON.parse(fileContentsWithIdPathAndCollection);
}

module.exports = {
  addUniqueGranuleFilePathToGranuleFiles,
  addUrlPathToGranuleFiles,
  loadFileWithUpdatedGranuleIdPathAndCollection,
  setupTestGranuleForIngest
};
