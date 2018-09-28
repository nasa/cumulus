'use strict';

const fs = require('fs-extra');
const {
  aws: { s3 },
  stringUtils: { globalReplace },
  testUtils: { randomStringFromRegex }
} = require('@cumulus/common');

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
 * @param {string} oldGranuleId - granule id of files to copy
 * @param {string} granuleRegex - regex to generate the new granule id
 * @param {string} testSuffix - suffix for test-specific collection
 * @param {string} testDataFolder - test data S3 path
 * @returns {Promise<Object>} - input payload as a JS object with the updated granule ids
 */
async function setupTestGranuleForIngest(bucket, inputPayloadJson, oldGranuleId, granuleRegex, testSuffix = '', testDataFolder = null) {
  // granule id for the new files
  const newGranuleId = randomStringFromRegex(granuleRegex);
  console.log(`\ngranule id: ${newGranuleId}`);

  if (testDataFolder) inputPayloadJson = globalReplace(inputPayloadJson, 'cumulus-test-data/pdrs', testDataFolder); //eslint-disable-line no-param-reassign
  const baseInputPayload = JSON.parse(inputPayloadJson);
  baseInputPayload.granules[0].dataType += testSuffix;

  await createGranuleFiles(
    baseInputPayload.granules[0].files,
    bucket,
    oldGranuleId,
    newGranuleId
  );

  const updatedInputPayloadJson = globalReplace(inputPayloadJson, oldGranuleId, newGranuleId);

  return JSON.parse(updatedInputPayloadJson);
}

/**
 * Read the file, update it with the new granule id, and return
 * the file as a JS object.
 *
 * @param {string} file - file path
 * @param {string} oldGranuleId - old granule id
 * @param {string} newGranuleId - new granule id
 * @param {string} oldPath - the old data path
 * @param {string} newPath - the new data path
 * @returns {Promise<Object>} - file as a JS object
 */
function loadFileWithUpdatedGranuleIdAndPath(file, oldGranuleId, newGranuleId, oldPath, newPath) {
  const fileContents = fs.readFileSync(file, 'utf8');
  let updatedFileContents = globalReplace(fileContents, oldGranuleId, newGranuleId);
  updatedFileContents = globalReplace(fileContents, oldPath, newPath);
  return JSON.parse(updatedFileContents);
}

module.exports = {
  loadFileWithUpdatedGranuleIdAndPath,
  setupTestGranuleForIngest
};
