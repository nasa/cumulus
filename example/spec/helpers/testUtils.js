'use strict';

const fs = require('fs');
const cloneDeep = require('lodash/cloneDeep');
const merge = require('lodash/merge');
const mime = require('mime-types');
const path = require('path');
const replace = require('lodash/replace');

const { headObject } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');
const { loadConfig } = require('@cumulus/integration-tests/config');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 20 * 60 * 1000;

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
 * @typedef {Object} StringReplacement
 * @property {string} old - the string to be replaced
 * @property {string} new - the replacement string
 */

/**
 * Upload a file from the test-data package to the S3 test data
 * and update contents with replacements
 *
 * @param {Object} params                         - parameters
 * @param {string} params.file                    - filename of data to upload
 * @param {string} params.bucket                  - bucket to upload to
 * @param {string} params.prefix                  - S3 folder prefix
 * @param {string} params.targetReplacementRegex  - regexp to allow file copy target to target
 *                                                  a different s3 key from the original file
 *                                                  if specified
 * @param {string} params.targetReplacementString - replacement value for targetReplacementRegex match
 * @param {Array<StringReplacement>} params.replacements - array of replacements in file content e.g. [{old: 'test', new: 'newTest' }]
 * @returns {Promise<Object>} - promise returned from S3 PUT
 */
async function updateAndUploadTestFileToBucket(params) {
  const {
    file,
    bucket,
    prefix,
    replacements = [],
    targetReplacementRegex,
    targetReplacementString,
  } = params;
  let data;
  if (replacements.length > 0) {
    data = fs.readFileSync(require.resolve(file), 'utf8');
    replacements.forEach((replacement) => {
      data = replace(data, new RegExp(replacement.old, 'g'), replacement.new);
    });
  } else {
    data = fs.readFileSync(require.resolve(file));
  }
  let key = path.basename(file);
  if (targetReplacementRegex) {
    key = key.replace(targetReplacementRegex, targetReplacementString);
  }

  return await s3().putObject({
    Bucket: bucket,
    Key: `${prefix}/${key}`,
    Body: data,
    ContentType: mime.lookup(key) || undefined,
  });
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
async function updateAndUploadTestDataToBucket(bucket, data, prefix, replacements) {
  let a = [];
  for (let i = 0; i < data.length; i+=1) {
    a.push(await updateAndUploadTestFileToBucket(
      {
        file: data[i],
        bucket, prefix, replacements
      }
    ))
  }
  // return await Promise.all(
  //   data.map(
  //     (file) =>
  //       updateAndUploadTestFileToBucket({
  //         file,
  //         bucket,
  //         prefix,
  //         replacements,
  //       })
  //   )
  // );
}

/**
 * For the given bucket, upload all the test data files to S3
 *
 * @param {string} bucket - S3 bucket
 * @param {Array<string>} data - list of test data files
 * @param {string} prefix - S3 folder prefix
 * @returns {Array<Promise>} - responses from S3 upload
 */
async function uploadTestDataToBucket(bucket, data, prefix) {
  return await updateAndUploadTestDataToBucket(bucket, data, prefix);
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
    Prefix: folder,
  });
  (l.Contents || []).forEach((item) => s3().deleteObject({
    Bucket: bucket,
    Key: item.Key,
  }));
  // await Promise.all((l.Contents || []).map((item) =>
  //   s3().deleteObject({
  //     Bucket: bucket,
  //     Key: item.Key,
  //   })));
}

/**
 * Returns execution ARN from a statement machine ARN and executionName
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
  if (!file.bucket || !file.key) {
    throw new Error(`Unable to determine file location: ${JSON.stringify(file)}`);
  }

  try {
    const headObjectResponse = await headObject(file.bucket, file.key);
    return {
      bucket: file.bucket,
      key: file.key,
      size: headObjectResponse.ContentLength,
      LastModified: headObjectResponse.LastModified,
    };
  } catch (error) {
    log.error(`Failed to headObject the object at ${file.bucket}/${file.key} in s3.`);
    throw (error);
  }
}

/**
 * Get file headers for a set of files.
 *
 * @param {Array<Object>} files - array of file objects
 * @returns {Promise<Array>} - file detail responses
 */
async function getFilesMetadata(files) {
  return await Promise.all(files.map(getFileMetadata));
}

function isValidAsyncOperationId(asyncOperationId) {
  return /[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/.test(asyncOperationId);
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
  updateAndUploadTestFileToBucket,
  uploadTestDataToBucket,
  isValidAsyncOperationId,
};
