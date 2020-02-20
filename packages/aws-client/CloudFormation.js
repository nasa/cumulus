const awsServices = require('./services');

/**
 * Describes a given CloudFormation stack
 *
 * See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStacks-property
 *
 * @param {string} stackName -  The name of the CloudFormation stack to query
 * @returns {Array<Object>} The resources belonging to the stack
 */
exports.describeCfStack = (stackName) =>
  awsServices.cf().describeStacks({ StackName: stackName })
    .promise()
    .then((response) => response.Stacks[0]);

/**
 * Describes the resources belonging to a given CloudFormation stack
 *
 * See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStackResources-property
 *
 * @param {string} stackName -  The name of the CloudFormation stack to query
 * @returns {Array<Object>} The resources belonging to the stack
 */
exports.describeCfStackResources = (stackName) =>
  awsServices.cf().describeStackResources({ StackName: stackName })
    .promise()
    .then((response) => response.StackResources);

/**
 * Get parameter values for the given CloudFormation stack
 *
 * @param {string} stackName
 *   The name of the CloudFormation stack to query
 * @param {Array<string>} parameterKeys
 *   Key names for the stack parameters that you want to return
 * @returns {Object} Object keyed by parameter names
 */
exports.getCfStackParameterValues = (stackName, parameterKeys = []) =>
  exports.describeCfStack(stackName)
    .then((response) => {
      const parameters = {};
      parameterKeys.forEach((parameterKey) => {
        const { ParameterValue } = response.Parameters
          .find((element) => element.ParameterKey === parameterKey);
        parameters[parameterKey] = ParameterValue;
      });
      return parameters;
    });
