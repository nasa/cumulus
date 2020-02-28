'use strict';

const { S3 } = require('aws-sdk');

/**
 * Receives event trigger from SNS and forwards event message to S3 bucket
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
  return s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${executionRecord.name}.output`,
    Body: JSON.stringify(event, null, 2)
  }).promise();
}

/**
 * Put granule messages from SNS topic onto S3.
 *
 * @param {Object} event - SNS message
 * @returns {Promise}
 */
async function handleGranules(event) {
  const s3 = new S3();
  const messageString = event.Records[0].Sns.Message;
  const granuleRecord = JSON.parse(messageString);
  if (!granuleRecord.granuleId) {
    return Promise.resolve();
  }
  return s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${granuleRecord.granuleId}-${granuleRecord.status}.output`,
    Body: JSON.stringify(event, null, 2)
  }).promise();
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
  return s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${pdr.pdrName}-${pdr.status}.output`,
    Body: JSON.stringify(event, null, 2)
  }).promise();
}

module.exports = {
  handleExecutions,
  handleGranules,
  handlePdrs
};
