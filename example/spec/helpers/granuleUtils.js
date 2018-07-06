'use strict';

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

module.exports = {
  randomGranuleId,
  createGranuleFiles
};

//sconsole.log(randomGranuleId('^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$'));