'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const pdrValid = require('./pdr-validations');

function logPdr(pdr) {
  log.info(`PDR: ${JSON.stringify(pdr, null, 2)}`);
}

function fetchPdr(bucket, key) {
  return aws.s3().getObject({ Bucket: bucket, Key: key }).promise()
    .then((response) => response.Body.toString());
}

function isPdrValid(topLevelErrors, fileGroupErrors) {
  return topLevelErrors.length > 0 || fileGroupErrors.some(errors => errors.length > 0);
}

async function handler(event, context, callback) {
  const pdr = await fetchPdr(event.input.bucket, event.input.key);

  logPdr(pdr);

  const [topLevelErrors, fileGroupErrors] = pdrValid.validatePdr(pdr);

  const status = isPdrValid(topLevelErrors, fileGroupErrors) ? 'OK' : 'ERROR';

  return callback(null, {
    status: status, // used by the Choice action
    top_level_errors: topLevelErrors,
    file_group_errors: fileGroupErrors
  });
}
exports.handler = handler;
