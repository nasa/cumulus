'use strict';

const {
  isNil,
  isNotArrayOfStrings,
  isNotNil,
  isNotString
} = require('./utils');

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
  validateOptionalString('deploymentBucket', config.deploymentBucket);
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

// Return the configured deployment bucket or false
module.exports.deploymentBucket = configFetcher('deploymentBucket', false);

// Return a boolean indicating whether the Lambda functions should be deployed
// to a VPC.  Returns true if both `vpcId` and `subnetIds` are set.
module.exports.deployToVpc = (_serverless, config) =>
  (isNotNil(config.vpcId) && isNotNil(config.subnetIds));

// Return the configured logsBucket or throw an exception
module.exports.logsBucket = configFetcher('logsBucket');

// Return the configured logsPrefix or an empty string
module.exports.logsPrefix = configFetcher('logsPrefix', '');

// Return the configured `permissionsBoundary` or Cloudformation's
// `AWS::NoValue`
module.exports.permissionsBoundary = configFetcher(
  'permissionsBoundary',
  { Ref: 'AWS::NoValue' }
);

// Return the configured prefix or throw an exception
module.exports.prefix = configFetcher('prefix');

// Return the configured stack or throw an exception
module.exports.stack = configFetcher('stack');

// Return the configured subnetIds or false
module.exports.subnetIds = (_serverless, config) => {
  validateConfig(config);

  return isNil(config.subnetIds) ? false : config.subnetIds;
};

// If both `vpcId` and `subnetIds` are set, return a VPC config.  Otherwise,
// return CloudFormation's `AWS::NoValue`
module.exports.vpcConfig = (_serverless, config) => {
  validateConfig(config);

  if (module.exports.deployToVpc(_serverless, config)) {
    return {
      securityGroupIds: [
        { 'Fn::GetAtt': ['LambdaSecurityGroup', 'GroupId'] }
      ],
      subnetIds: config.subnetIds
    };
  }

  return { Ref: 'AWS::NoValue' };
};

// Return the configured vpcId or false
module.exports.vpcId = configFetcher('vpcId', false);
