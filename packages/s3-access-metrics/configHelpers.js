'use strict';

const { isNil, isNotNil } = require('./utils');

// Fetch a config value from the config, returning false if it is not set
const configValueOrFalse = (key) =>
  (_serverless, config) => (isNil(config[key]) ? false : config[key]);

// Fetch a value from the config, throwing an exception if it is not set
const configValueOrThrow = (key) =>
  (_serverless, config) => {
    if (isNil(config[key])) throw new Error(`${key} must be set`);

    return config[key];
  };

// Return the configured deployment bucket or false
module.exports.deploymentBucket = configValueOrFalse('deploymentBucket');

// Return a boolean indicating whether the Lambda functions should be deployed
// to a VPC.  Returns true if both `vpcId` and `subnetIds` are set.
module.exports.deployToVpc = (_serverless, config) =>
  (isNotNil(config.vpcId) && isNotNil(config.subnetIds));

// Return the configured logsBucket or throw an exception
module.exports.logsBucket = configValueOrThrow('logsBucket');

// Return the configured logsPrefix or an empty string
module.exports.logsPrefix = (_serverless, config) =>
  (isNil(config.logsPrefix) ? '' : config.logsPrefix);

// Return the configured `permissionsBoundary` or Cloudformation's
// `AWS::NoValue`
module.exports.permissionsBoundary = (_serverless, config) =>
  (isNil(config.permissionsBoundary)
    ? { Ref: 'AWS::NoValue' }
    : config.permissionsBoundary);

// Return the configured prefix or throw an exception
module.exports.prefix = configValueOrThrow('prefix');

// Return the configured stack or throw an exception
module.exports.stack = configValueOrThrow('stack');

// Return the configured subnetIds or false
module.exports.subnetIds = configValueOrFalse('subnetIds');

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
module.exports.vpcId = configValueOrFalse('vpcId');
