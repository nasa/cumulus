const fs = require('fs');
const { S3 } = require('aws-sdk');
const { Config } = require('kes');
const lodash = require('lodash');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000000;

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
  const inputTemplate = JSON.parse(fs.readFileSync(inputTemplateFilename));
  const templatedInput = lodash.merge(lodash.cloneDeep(inputTemplate), config);
  let jsonString = JSON.stringify(templatedInput, null, 2);
  jsonString = jsonString.replace('{{AWS_ACCOUNT_ID}}', config.AWS_ACCOUNT_ID);
  const templatedInputFilename = inputTemplateFilename.replace('.template', '');
  fs.writeFileSync(templatedInputFilename, jsonString);
  return templatedInputFilename;
}

/**
 * Delete a folder on a given bucket on S3
 *
 * @param {string} bucket - the bucket name
 * @param {string} folder - the folder to delete
 * @returns {Promise} undefined
 */
async function deleteFolder(bucket, folder) {
  const s3 = new S3();

  const l = await s3.listObjectsV2({
    Bucket: bucket,
    Prefix: folder
  }).promise();

  await Promise.all(l.Contents.map((item) => {
    return s3.deleteObject({
      Bucket: bucket,
      Key: item.Key
    }).promise();
  }));
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

module.exports = {
  loadConfig,
  templateFile,
  deleteFolder,
  getExecutionUrl
};
