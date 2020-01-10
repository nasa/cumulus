const awsServices = require('./services');

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
