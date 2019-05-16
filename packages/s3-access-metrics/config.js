'use strict';

const fs = require('fs');
// eslint-disable-next-line node/no-unpublished-require
const yaml = require('js-yaml');
const { promisify } = require('util');

// eslint-disable-next-line lodash/prefer-is-nil
const isNil = (x) => x === undefined || x === null;

const isNotNil = (x) => !isNil(x);

const boolToString = (x) => `${x}`;

const readFile = promisify(fs.readFile);

// Load config.yml into a Javscript object
const loadConfig = () => readFile('./config.yml', 'utf8').then(yaml.safeLoad);

// Given a key, fetch the associated value from config.yml
const getConfigValue = (key) => loadConfig().then((config) => config[key]);

// Fetch a config value from config.yml, returning false if it is not set
const configValueOrFalse = (key) =>
  () => getConfigValue(key).then((v) => v || false);

// Fetch a config value from config.yml, throwing an exception if it is not set
const configValueOrThrow = (key) =>
  () =>
    getConfigValue(key)
      .then((v) => {
        if (v) return v;
        throw new Error(`${key} must be set in config.yml`);
      });

// Return a boolean indicating whether the Lambda functions should be deployed
// to a VPC.  Returns true if both `vpcId` and `subnetIds` are set.
const deployToVpc = async () => {
  const vpcIdValue = await getConfigValue('vpcId');
  const subnetsIdsValue = await getConfigValue('subnetIds');

  return isNotNil(vpcIdValue) && isNotNil(subnetsIdsValue);
};

// Return the configured `permissionsBoundary` or Cloudformation's
// `AWS::NoValue`
const permissionsBoundary = async () => {
  const permissionsBoundaryValue = await getConfigValue('permissionsBoundary');

  if (permissionsBoundaryValue) return permissionsBoundaryValue;

  return { Ref: 'AWS::NoValue' };
};

// If both `vpcId` and `subnetIds` are set, return a VPC config.  Otherwise,
// return CloudFormation's `AWS::NoValue`
const vpcConfig = async () => {
  if (await deployToVpc()) {
    return {
      securityGroupIds: [
        { 'Fn::GetAtt': ['LambdaSecurityGroup', 'GroupId'] }
      ],
      subnetIds: await getConfigValue('subnetIds')
    };
  }

  return { Ref: 'AWS::NoValue' };
};

// Return the configured logsPrefix or an empty string
const logsPrefix = async () => {
  const logsPrefixValue = await getConfigValue('logsPrefix');

  return isNil(logsPrefixValue) ? '' : logsPrefixValue;
};

// The result of evaluating these functions is available in `serverless.yml` by
// using ${file(./config.js):propNameHere}
module.exports = {
  logsPrefix,
  permissionsBoundary,
  vpcConfig,
  deploymentBucket: configValueOrFalse('deploymentBucket'),
  deployToVpc: () => deployToVpc().then(boolToString),
  logsBucket: configValueOrThrow('logsBucket'),
  prefix: configValueOrThrow('prefix'),
  stack: configValueOrThrow('stack'),
  subnetIds: configValueOrFalse('subnetIds'),
  vpcId: configValueOrFalse('vpcId')
};
