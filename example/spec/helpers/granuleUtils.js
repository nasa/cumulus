'use strict';

const fs = require('fs');
const RandExp = require('randexp');
const { s3 } = require('@cumulus/common/aws');

function randomGranuleId(regex) {
  const jsRegex = new RegExp(regex);
  return new RandExp(jsRegex).gen();
}

async function createGranuleFiles(granuleFiles, bucket, origGranuleId, newGranuleId) {
  const copyPromises = granuleFiles.map((f) =>
    s3().copyObject({
      Bucket: bucket,
      CopySource: `${bucket}/${f.path}/${f.name}`,
      Key: `${f.path}/${f.name.replace(origGranuleId, newGranuleId)}`
    }).promise());

  return Promise.all(copyPromises);
}


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
