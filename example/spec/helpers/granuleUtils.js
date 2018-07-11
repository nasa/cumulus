'use strict';

const fs = require('fs-extra');
const {
  aws: { s3 },
  stringUtils: { globalReplace }
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
    }).promise();

  return Promise.all(granuleFiles.map(copyFile));
}

/**
 * Read the file, update it with the new granule id, and return
 * the file as a JS object.
 *
 * @param {string} file - file path
 * @param {string} oldGranuleId - old granule id
 * @param {string} newGranuleId - new granule id
 * @returns {Promise<Object>} - file as a JS object
 */
function loadFileWithUpdatedGranuleId(file, oldGranuleId, newGranuleId) {
  const fileContents = fs.readFileSync(file, 'utf8');
  const updatedFileContents = globalReplace(fileContents, oldGranuleId, newGranuleId);
  return JSON.parse(updatedFileContents);
}

module.exports = {
  createGranuleFiles,
  loadFileWithUpdatedGranuleId
};
