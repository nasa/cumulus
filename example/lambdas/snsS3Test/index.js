'use strict';

const { S3 } = require('@aws-sdk/client-s3');

/**
 * Receives event trigger from SNS and forwards event message to S3 bucket.
 *
 * @param {Object} event - from SNS
 * @returns {Promise} confirmation of added message
 */
async function handleExecutions(event) {
  const s3 = new S3();
  const messageString = event.Records[0].Sns.Message;
  const executionRecord = JSON.parse(messageString);
  if (!executionRecord.name) {
    return Promise.resolve();
  }
  return await s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${executionRecord.name}-${executionRecord.status}.output`,
    Body: JSON.stringify(event, undefined, 2),
  });
}

/**
 * Put granule messages from SNS topic onto S3.
 *
 * @param {Object} event - SNS message
 * @returns {Promise}
 */
async function handleGranules(event) {
  const {
    event: eventType,
    record: granule,
  } = JSON.parse(event.Records[0].Sns.Message);
  const s3 = new S3();
  if (!granule.granuleId) {
    return Promise.resolve();
  }
  return await s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${granule.granuleId}-${granule.status}-${eventType}.output`,
    Body: JSON.stringify(event, undefined, 2),
  });
}

/**
 * Put PDR messages from SNS topic onto S3.
 *
 * @param {Object} event - from SNS
 * @returns {Promise} confirmation of added message
 */
async function handlePdrs(event) {
  const s3 = new S3();
  const messageString = event.Records[0].Sns.Message;
  const pdr = JSON.parse(messageString);
  if (!pdr.pdrName) {
    return Promise.resolve();
  }
  return await s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${pdr.pdrName}-${pdr.status}.output`,
    Body: JSON.stringify(event, undefined, 2),
  });
}

/**
 * Put collection messages from SNS topic onto S3.
 *
 * @param {Object} event - from SNS
 * @returns {Promise} confirmation of added message
 */
async function handleCollections(event) {
  const {
    event: eventType,
    record: collection,
  } = JSON.parse(event.Records[0].Sns.Message);

  if (!collection.name) {
    return undefined;
  }

  const s3 = new S3();

  return await s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${collection.name}-${collection.version}-${eventType}.output`,
    Body: JSON.stringify(event, undefined, 2),
  });
}

module.exports = {
  handleExecutions,
  handleGranules,
  handlePdrs,
  handleCollections,
};
