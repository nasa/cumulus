'use strict';

const aws = require('./aws');
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
  const bucketsString = await aws.s3().getObject({
    Bucket: bucket,
    Key: `${stackName}/workflows/buckets.json`
  }).promise();
  return JSON.parse(bucketsString.Body);
}


module.exports = bucketsConfigJsonObject;
