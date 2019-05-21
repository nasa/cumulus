'use strict';

const {
  isNil,
  isNotArrayOfStrings,
  isNotNil,
  isNotString
} = require('./utils');

const noValue = () => ({ Ref: 'AWS::NoValue' });

const validateIsArrayOfStrings = (name, value) => {
  if (isNotArrayOfStrings(value)) {
    throw new Error(`${name} must be an array of strings`);
  }
};

const validateIsSet = (name, value) => {
  if (isNil(value)) throw new Error(`${name} must be set`);
};

const validateIsString = (name, value) => {
  if (isNotString(value)) throw new Error(`${name} must be a string`);
};

const validateRequiredString = (name, value) => {
  validateIsSet(name, value);
  validateIsString(name, value);
};

const validateOptionalString = (name, value) => {
  if (isNil(value)) return;
  validateIsString(name, value);
};

const validateSubnetIds = ({ subnetIds, vpcId }) => {
  if (isNotNil(subnetIds)) {
    if (isNil(vpcId)) {
      throw new Error('Both vpcId and subnetIds must be set');
    }

    validateIsArrayOfStrings('subnetIds', subnetIds);
  }
};

const validateVpcId = ({ subnetIds, vpcId }) => {
  if (isNotNil(vpcId)) {
    if (isNil(subnetIds)) {
      throw new Error('Both vpcId and subnetIds must be set');
    }

    validateIsString('vpcId', vpcId);
  }
};

const validateConfig = (config) => {
  validateRequiredString('logsBucket', config.logsBucket);
  validateOptionalString('logsPrefix', config.logsPrefix);
  validateOptionalString('permissionsBoundary', config.permissionsBoundary);
  validateRequiredString('prefix', config.prefix);
  validateRequiredString('stack', config.stack);
  validateSubnetIds(config);
  validateVpcId(config);
};

const configFetcher = (key, defaultValue) =>
  (_serverless, config) => {
    validateConfig(config);

    return isNil(config[key]) ? defaultValue : config[key];
  };

const deployToVpc = (_serverless, config) => (
  isNotNil(config.vpcId)
  && isNotNil(config.subnetIds)
);

const vpcConfig = (_serverless, config) => {
  validateConfig(config);

  if (module.exports.deployToVpc(_serverless, config)) {
    return {
      securityGroupIds: [
        { 'Fn::GetAtt': ['LambdaSecurityGroup', 'GroupId'] }
      ],
      subnetIds: config.subnetIds
    };
  }

  return noValue();
};

module.exports = {
  deployToVpc,
  vpcConfig,
  logsBucket: configFetcher('logsBucket'),
  logsPrefix: configFetcher('logsPrefix', ''),
  permissionsBoundary: configFetcher('permissionsBoundary', noValue()),
  prefix: configFetcher('prefix'),
  stack: configFetcher('stack'),
  subnetIds: configFetcher('subnetIds', false),
  vpcId: configFetcher('vpcId', false)
};
