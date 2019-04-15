'use strict';

const fs = require('fs');
const { Config } = require('kes');
const cloneDeep = require('lodash.clonedeep');
const mime = require('mime-types');
const merge = require('lodash.merge');
const path = require('path');
const { promisify } = require('util');
const tempy = require('tempy');
const execa = require('execa');
const pTimeout = require('p-timeout');

const {
  aws: { s3, headObject, parseS3Uri },
  stringUtils: { globalReplace }
} = require('@cumulus/common');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000000;

const timestampedName = (name) => `${name}_${(new Date().getTime())}`;

const createTimestampedTestId = (stackName, testName) => `${stackName}-${testName}-${(new Date().getTime())}`;
const createTestDataPath = (prefix) => `${prefix}-test-data/files`;
const createTestSuffix = (prefix) => `_test-${prefix}`;

const MILLISECONDS_IN_A_MINUTE = 60 * 1000;

/**
 * Loads and parses the configuration defined in `./app/config.yml`
 *
 * @returns {Object} - Configuration object
*/
function loadConfig() {
  // make sure deployment env variable is set
  if (!process.env.DEPLOYMENT) {
    throw new Error(
      'You MUST set DEPLOYMENT environment variable with the name' +
      ' of your deployment before running tests.'
    );
  }

  const params = {
    deployment: process.env.DEPLOYMENT,
    configFile: './app/config.yml',
    kesFolder: './app'
  };

  const config = new Config(params);

  if (config.deployment === 'default') {
    throw new Error('the default deployment cannot be used for integration tests');
  }

  config.test_configs.buckets = config.buckets;
  config.test_configs.deployment = config.deployment;
  config.test_configs.cmr = config.cmr;

  return config.test_configs;
}

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

/**
 * Redeploy the current Cumulus deployment.
 *
 * @param {Object} config - configuration object from loadConfig()
 * @param {Object} [options] - configuration options with the following keys>
 * @param {string} [options.template=template=node_modules/@cumulus/deployment/app] - optional template command line kes option
 * @param {string} [options.kesClass] - optional kes-class command line kes option
 * @param {integer} [options.timeout=30] - Timeout value in minutes
 * @returns {Promise<undefined>}
 */
async function redeploy(config, options = {}) {
  const timeoutInMinutes = options.timeout || 30;

  const deploymentCommand = './node_modules/.bin/kes';

  const deploymentOptions = [
    'cf', 'deploy',
    '--kes-folder', options.kesFolder || 'app',
    '--template', options.template || 'node_modules/@cumulus/deployment/app',
    '--deployment', config.deployment,
    '--region', 'us-east-1'
  ];

  if (options.kesClass) deploymentOptions.push('--kes-class', options.kesClass);

  const deploymentProcess = execa(deploymentCommand, deploymentOptions);

  deploymentProcess.stdout.pipe(process.stdout);
  deploymentProcess.stderr.pipe(process.stderr);

  await pTimeout(
    deploymentProcess,
    timeoutInMinutes * MILLISECONDS_IN_A_MINUTE
  );
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

  const headObjectResponse = await headObject(Bucket, Key);

  return {
    filename: file.filename,
    fileSize: headObjectResponse.ContentLength,
    LastModified: headObjectResponse.LastModified
  };
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

const promisedCopyFile = promisify(fs.copyFile);
const promisedUnlink = promisify(fs.unlink);

/**
 * Creates a backup of a file, executes the specified function, and makes sure
 * that the file is restored from backup.
 *
 * @param {string} file - the file to backup
 * @param {Function} fn - the function to execute
 */
async function protectFile(file, fn) {
  const backupLocation = tempy.file();
  await promisedCopyFile(file, backupLocation);

  try {
    return await Promise.resolve().then(fn);
  } finally {
    await promisedCopyFile(backupLocation, file);
    await promisedUnlink(backupLocation);
  }
}

const isLambdaStatusLogEntry = (logEntry) =>
  logEntry.message.includes('START') ||
  logEntry.message.includes('END') ||
  logEntry.message.includes('REPORT');

const isCumulusLogEntry = (logEntry) => !isLambdaStatusLogEntry(logEntry);

module.exports = {
  timestampedName,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  loadConfig,
  templateFile,
  updateAndUploadTestDataToBucket,
  uploadTestDataToBucket,
  deleteFolder,
  getExecutionUrl,
  redeploy,
  getFilesMetadata,
  protectFile,
  isCumulusLogEntry
};
