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

const loadConfig = () => readFile('./config.yml', 'utf8').then(yaml.safeLoad);

const getConfigValue = (key) => loadConfig().then((config) => config[key]);

const configValueOrFalse = (key) =>
  () => getConfigValue(key).then((v) => v || false);

const configValueOrThrow = (key) =>
  () =>
    getConfigValue(key)
      .then((v) => {
        if (v) return v;
        throw new Error(`${key} must be set in config.yml`);
      });

const deployToVpc = async () => {
  const vpcIdValue = await getConfigValue('vpcId');
  const subnetsIdsValue = await getConfigValue('subnetIds');

  return isNotNil(vpcIdValue) && isNotNil(subnetsIdsValue);
};

const permissionsBoundary = async () => {
  const permissionsBoundaryValue = await getConfigValue('permissionsBoundary');

  if (permissionsBoundaryValue) return permissionsBoundaryValue;

  return { Ref: 'AWS::NoValue' };
};

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

const logsPrefix = async () => {
  const logsPrefixValue = await getConfigValue('logsPrefix');

  return isNil(logsPrefixValue) ? '' : logsPrefixValue;
};

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
