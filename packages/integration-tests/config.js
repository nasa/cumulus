'use strict';

const dotenv = require('dotenv');
const get = require('lodash.get');
const yaml = require('js-yaml');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const { isNil } = require('@cumulus/common/util');
const { readFile, readFileSync } = require('fs-extra');

/**
 * Load a yml file
 *
 * @param {string} filePath - workflow yml filepath
 * @returns {Object} - JS Object representation of yml file
 */
function loadYmlFile(filePath) {
  return yaml.safeLoad(readFileSync(filePath, 'utf8'));
}

const loadConfigYmlFile = (stackName) => {
  const ymlConfigs = loadYmlFile('./config.yml');
  const stackConfig = get(ymlConfigs, stackName, {});

  return {
    ...ymlConfigs.default,
    ...stackConfig,
    stackName
  };
};

const loadEnvFile = async (filename) => {
  try {
    const envConfig = dotenv.parse(await readFile(filename));

    Object.keys(envConfig).forEach((k) => {
      if (isNil(process.env[k])) process.env[k] = envConfig[k];
    });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
};

const verifyRequiredEnvironmentVariables = () => {
  [
    'DEPLOYMENT',
    'AWS_REGION',
    'AWS_ACCOUNT_ID',
    'EARTHDATA_CLIENT_ID',
    'EARTHDATA_CLIENT_PASSWORD',
    'EARTHDATA_PASSWORD',
    'EARTHDATA_USERNAME',
    'TOKEN_SECRET'
  ].forEach((x) => {
    if (isNil(process.env[x])) {
      throw new Error(`Environment variable "${x}" is not set.`);
    }
  });
};

const loadConfig = async () => {
  await loadEnvFile('./.env');
  verifyRequiredEnvironmentVariables();

  const configFromFile = loadConfigYmlFile(process.env.DEPLOYMENT);

  const buckets = await getJsonS3Object(
    configFromFile.bucket,
    `${configFromFile.stackName}/workflows/buckets.json`
  );

  return { ...configFromFile, buckets };
};

module.exports = {
  loadConfig,
  loadYmlFile
};
