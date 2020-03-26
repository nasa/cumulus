'use strict';

const aws = require('./aws');
const { deprecate } = require('./util');

/**
 * Retrieve the stack's bucket configuration from s3 and return the bucket configuration object.
 *
 * @param {string} bucket - system bucket name.
 * @param {string} stackName - stack name.
 * @returns {Object} - stack's bucket configuration.
 */
async function bucketsConfigJsonObject(
  bucket = process.env.system_bucket,
  stackName = process.env.stackName
) {
  deprecate('@cumulus/common/bucketsConfigJsonObject', '1.20.0');
  const Key = `${stackName}/workflows/buckets.json`;
  try {
    const bucketsString = await aws.s3().getObject({
      Bucket: bucket,
      Key
    }).promise();
    return JSON.parse(bucketsString.Body);
  } catch (error) {
    error.message = `Unable to read bucketsConfiguration from ${bucket}/${Key}: ${error.message}`;
    throw error;
  }
}

module.exports = bucketsConfigJsonObject;
