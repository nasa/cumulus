'use strict';

const every = require('lodash.every');
const isArray = require('lodash.isarray');
const isString = require('lodash.isstring');
const { isNil, isNotNil } = require('./utils');

const validateIdentity = (_name, value) => value;

const validateIsArrayOfStrings = (name, value) => {
  if (!isArray(value)) throw new Error(`${name} must be an array`);

  if (!every(value, isString)) {
    throw new Error(`${name} must be an array of strings`);
  }

  return value;
};

const validateIsString = (name, value) => {
  if (isString(value)) return value;

  throw new Error(`${name} must be a string`);
};

// Fetch a config value from the config, returning false if it is not set
const configValueOrFalse = (key, validationFunction = validateIdentity) =>
  (_serverless, config) => (
    isNil(config[key])
      ? false
      : validationFunction(key, config[key])
  );

// Fetch a value from the config, throwing an exception if it is not set
const configValueOrThrow = (key, validationFunction = validateIdentity) =>
  (_serverless, config) => {
    if (isNil(config[key])) throw new Error(`${key} must be set`);

    return validationFunction(key, config[key]);
  };

// Return the configured deployment bucket or false
module.exports.deploymentBucket = configValueOrFalse(
  'deploymentBucket',
  validateIsString
);

// Return a boolean indicating whether the Lambda functions should be deployed
// to a VPC.  Returns true if both `vpcId` and `subnetIds` are set.
module.exports.deployToVpc = (_serverless, config) =>
  (isNotNil(config.vpcId) && isNotNil(config.subnetIds));

// Return the configured logsBucket or throw an exception
module.exports.logsBucket = configValueOrThrow('logsBucket', validateIsString);

// Return the configured logsPrefix or an empty string
module.exports.logsPrefix = (_serverless, config) => (
  isNil(config.logsPrefix)
    ? ''
    : validateIsString('logsPrefix', config.logsPrefix)
);

// Return the configured `permissionsBoundary` or Cloudformation's
// `AWS::NoValue`
module.exports.permissionsBoundary = (_serverless, config) => (
  isNil(config.permissionsBoundary)
    ? { Ref: 'AWS::NoValue' }
    : validateIsString('permissionsBoundary', config.permissionsBoundary)
);

// Return the configured prefix or throw an exception
module.exports.prefix = configValueOrThrow('prefix', validateIsString);

// Return the configured stack or throw an exception
module.exports.stack = configValueOrThrow('stack', validateIsString);

// Return the configured subnetIds or false
module.exports.subnetIds = (_serverless, config) => {
  if (isNil(config.subnetIds)) return false;

  if (isNil(config.vpcId)) throw new Error('Both vpcId and subnetIds must be set');

  return validateIsArrayOfStrings('subnetIds', config.subnetIds);
};

// If both `vpcId` and `subnetIds` are set, return a VPC config.  Otherwise,
// return CloudFormation's `AWS::NoValue`
module.exports.vpcConfig = (_serverless, config) => {
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
module.exports.vpcId = (_serverless, config) => {
  if (isNil(config.vpcId)) return false;

  if (isNil(config.subnetIds)) throw new Error('Both vpcId and subnetIds must be set');

  return validateIsString('vpcId', config.vpcId);
};
