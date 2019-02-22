'use strict';

const { S3, Credentials } = require('aws-sdk');


/**
 * Lambda handler that tests GET access on an S3 bucket by calling getObject on
 * a file in the bucket. Returns true if the body is not null, false otherwise
 *
 * @param {S3} s3 - S3 service object
 * @param {Object} params - test parameters
 * @returns {boolean} - true if the object is readable, false otherwise.
 */
async function testGet(s3, params) {
  try {
    const result = await s3.getObject(params).promise();
    return result.Body !== null;
  }
  catch (error) {
    return false;
  }
}

/**
 * Lambda handler that tests WRITE access on an S3 bucket by calling putObject on
 * a protected bucket. Returns true if the write succeeds, false otherwise.
 *
 * @param {S3} s3 - S3 service object
 * @param {Object} params - test parameters
 * @returns {boolean} - true if the bucket is writable, false otherwise.
 */
async function testWrite(s3, params) {
  const callParams = { ...params, ...{ Body: 'testWrite String.' } };
  try {
    await s3.putObject(callParams).promise();
    return true;
  }
  catch (error) {
    return false;
  }
}

/**
 * Lambda handler that tests WRITE access on an S3 bucket by calling putObject on
 * a protected bucket. Returns true if the write succeeds, false otherwise.
 *
 * @param {S3} s3 - S3 service object
 * @param {Object} params - test parameters
 * @returns {boolean} - true if the bucket is writable, false otherwise.
 */
async function testList(s3, params) {
  /* eslint-disable-next-line no-unused-vars */
  const { Key, ...callParams } = { ...params, ...{ Prefix: params.Key } };

  try {
    await s3.listObjectsV2(callParams).promise();
    return true;
  }
  catch (error) {
    return false;
  }
}

/**
 * Lambda handler that tests GET access on an S3 bucket by calling getObject on
 * a file in the bucket. Returns true if the body is not null or an error is
 * raised.
 *
 * @param {Object} event - S3 bucket and key to test access
 *                         i.e. { Bucket: 's3-bucket',
 *                                Key: 'test.txt',
 *                                credentials,
 *                                testName }
 * @returns {undefined} - does not return a value
 */
async function handler(event) {
  const { credentials, testName, ...params } = event;
  const s3 = new S3({ credentials: new Credentials(JSON.parse(credentials)) });

  const testChoices = {
    'get-object': testGet,
    'write-object': testWrite,
    'list-objects': testList
  };
  return testChoices[testName](s3, params);
}

exports.handler = handler;
