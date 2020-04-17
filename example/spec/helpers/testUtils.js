'use strict';

const fs = require('fs');
const cloneDeep = require('lodash/cloneDeep');
const merge = require('lodash/merge');
const mime = require('mime-types');
const path = require('path');

const { headObject, parseS3Uri } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');
const { globalReplace } = require('@cumulus/common/string');
const { loadConfig } = require('@cumulus/integration-tests/config');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000000;

const timestampedName = (name) => `${name}_${(new Date().getTime())}`;

const createTimestampedTestId = (stackName, testName) =>
  `${stackName}-${testName}-${Date.now()}`;
const createTestDataPath = (prefix) => `${prefix}-test-data/files`;
const createTestSuffix = (prefix) => `_test-${prefix}`;

/**
 * Creates a new file using a template file and configuration object which
 * defines fields to write to in the input template.
 *
 * @param   {Object} options - Options
 * @param   {string} options.inputTemplateFilename - File path and name of template file (json)
 * @param   {Object} options.config - Object to use to write to fields in the template
 * @returns {string} - File path and name of output file (json)
 */
function templateFile({ inputTemplateFilename, config }) {
  const inputTemplate = JSON.parse(fs.readFileSync(inputTemplateFilename, 'utf8'));
  const templatedInput = merge(cloneDeep(inputTemplate), config);
  let jsonString = JSON.stringify(templatedInput, null, 2);
  jsonString = jsonString.replace('{{AWS_ACCOUNT_ID}}', config.AWS_ACCOUNT_ID);
  const templatedInputFilename = inputTemplateFilename.replace('.template', '');
  fs.writeFileSync(templatedInputFilename, jsonString);
  return templatedInputFilename;
}

/**
 * Upload a file from the test-data package to the S3 test data
 * and update contents with replacements
 *
 * @param {string} file - filename of data to upload
 * @param {string} bucket - bucket to upload to
 * @param {string} prefix - S3 folder prefix
 * @param {Array<Object>} [replacements] - array of replacements in file content e.g. [{old: 'test', new: 'newTest' }]
 * @returns {Promise<Object>} - promise returned from S3 PUT
 */
function updateAndUploadTestFileToBucket(file, bucket, prefix = 'cumulus-test-data/pdrs', replacements = []) {
  let data;
  if (replacements.length > 0) {
    data = fs.readFileSync(require.resolve(file), 'utf8');
    replacements.forEach((replace) => {
      data = globalReplace(data, replace.old, replace.new);
    });
  } else data = fs.readFileSync(require.resolve(file));
  const key = path.basename(file);
  return s3().putObject({
    Bucket: bucket,
    Key: `${prefix}/${key}`,
    Body: data,
    ContentType: mime.lookup(key) || null
  }).promise();
}

/**
 * For the given bucket, upload all the test data files to S3
 * and update contents with replacements
 *
 * @param {string} bucket - S3 bucket
 * @param {Array<string>} data - list of test data files
 * @param {string} prefix - S3 folder prefix
 * @param {Array<Object>} [replacements] - array of replacements in file content e.g. [{old: 'test', new: 'newTest' }]
 * @returns {Array<Promise>} - responses from S3 upload
 */
function updateAndUploadTestDataToBucket(bucket, data, prefix, replacements) {
  return Promise.all(data.map((file) => updateAndUploadTestFileToBucket(file, bucket, prefix, replacements)));
}

/**
 * For the given bucket, upload all the test data files to S3
 *
 * @param {string} bucket - S3 bucket
 * @param {Array<string>} data - list of test data files
 * @param {string} prefix - S3 folder prefix
 * @returns {Array<Promise>} - responses from S3 upload
 */
function uploadTestDataToBucket(bucket, data, prefix) {
  return updateAndUploadTestDataToBucket(bucket, data, prefix);
}

/**
 * Delete a folder on a given bucket on S3
 *
 * @param {string} bucket - the bucket name
 * @param {string} folder - the folder to delete
 * @returns {Promise} undefined
 */
async function deleteFolder(bucket, folder) {
  const l = await s3().listObjectsV2({
    Bucket: bucket,
    Prefix: folder
  }).promise();

  await Promise.all(l.Contents.map((item) =>
    s3().deleteObject({
      Bucket: bucket,
      Key: item.Key
    }).promise()));
}

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} executionArn - execution ARN
 * @returns {string} return aws console url for the execution
 */
function getExecutionUrl(executionArn) {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return `https://console.aws.amazon.com/states/home?region=${region}` +
          `#/executions/details/${executionArn}`;
}

async function getFileMetadata(file) {
  let Bucket;
  let Key;
  if (file.bucket && file.filepath) {
    Bucket = file.bucket;
    Key = file.filepath;
  } else if (file.bucket && file.key) {
    Bucket = file.bucket;
    Key = file.key;
  } else if (file.filename) {
    const parsedUrl = parseS3Uri(file.filename);
    Bucket = parsedUrl.Bucket;
    Key = parsedUrl.Key;
  } else {
    throw new Error(`Unable to determine file location: ${JSON.stringify(file)}`);
  }

  try {
    const headObjectResponse = await headObject(Bucket, Key);
    return {
      filename: file.filename,
      size: headObjectResponse.ContentLength,
      LastModified: headObjectResponse.LastModified
    };
  } catch (err) {
    log.error(`Failed to headObject the object at ${Bucket}/${Key} in s3.`);
    throw (err);
  }
}

/**
 * Get file headers for a set of files.
 *
 * @param {Array<Object>} files - array of file objects
 * @returns {Promise<Array>} - file detail responses
 */
function getFilesMetadata(files) {
  return Promise.all(files.map(getFileMetadata));
}

module.exports = {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  getExecutionUrl,
  getFilesMetadata,
  loadConfig,
  templateFile,
  timestampedName,
  updateAndUploadTestDataToBucket,
  uploadTestDataToBucket
};
