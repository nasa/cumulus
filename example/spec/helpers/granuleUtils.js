'use strict';

const fs = require('fs');
const RandExp = require('randexp');
const { s3 } = require('@cumulus/common/aws');

/**
 * Create a random granule id from the regular expression
 * 
 * @param {string} regex - regular expression string
 * @returns {string} - random granule id
 */
function randomGranuleId(regex) {
  const jsRegex = new RegExp(regex);
  return new RandExp(jsRegex).gen();
}

/**
 * Create test granule files by copying current granule files and renaming
 * with new granule id
 *
 * @param {Array<Object>} granuleFiles - array of granule file object
 * @param {string} bucket - source/destination bucket
 * @param {string} origGranuleId - granule id of files to copy
 * @param {string} newGranuleId - new granule id
 * @returns {Array<Promise>} - promises from S3 copy
 */
function createGranuleFiles(granuleFiles, bucket, origGranuleId, newGranuleId) {
  const copyPromises = granuleFiles.map((f) =>
    s3().copyObject({
      Bucket: bucket,
      CopySource: `${bucket}/${f.path}/${f.name}`,
      Key: `${f.path}/${f.name.replace(origGranuleId, newGranuleId)}`
    }).promise());

  return Promise.all(copyPromises);
}

/**
 * Replace json string with new granule id
 *
 * @param {string} json - JSON string
 * @param {string} granuleId - new granule id
 * @param {string} testDataGranuleId - granule id to replace
 * @returns {string} - string replaced with new granule id 
 */
function updateJsonWithGranuleId(json, granuleId, testDataGranuleId) {
  return json.replace(new RegExp(testDataGranuleId, 'g'), granuleId)
}

/**
 * Read the file, update it with the new granule id, and return 
 * the file as a JS object
 *
 * @param {string} file - file path
 * @param {string} granuleId - new granule id
 * @returns {Object} - file as a JS object
 */
function fileWithUpdateGranuleId(file, granuleId, testDataGranuleId) {
  return JSON.parse(
    updateJsonWithGranuleId(fs.readFileSync(file, 'utf8'), granuleId, testDataGranuleId));
}

module.exports = {
  randomGranuleId,
  createGranuleFiles,
  fileWithUpdateGranuleId,
  updateJsonWithGranuleId
};
