/**
 * @module CloudFormation
 */

import pick from 'lodash/pick';
import { cf } from './services';

/**
 * Describes a given CloudFormation stack
 *
 * See [CloudFormation.Stack](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStacks-property)
 *
 * @param {string} StackName - The name of the CloudFormation stack to query
 * @returns {Promise<CloudFormation.Stack>} The resources belonging to the stack
 */
export const describeCfStack = async (StackName: string) => {
  const response = await cf().describeStacks({ StackName });

  if (response.Stacks) return response.Stacks[0];

  throw new Error(`Stack not found: ${StackName}`);
};

/**
 * Describes the resources belonging to a given CloudFormation stack
 *
 * See [CloudFormation.StackResources](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStackResources-property)
 *
 * @param {string} StackName - The name of the CloudFormation stack to query
 * @returns {Promise<CloudFormation.StackResources>} The resources belonging to the stack
 */
export const describeCfStackResources = async (StackName: string) => {
  const response = await cf().describeStackResources({ StackName });

  return response.StackResources;
};

/**
 * Get parameter values for the given CloudFormation stack
 *
 * @param {string} stackName - The name of the CloudFormation stack to query
 * @param {Array<string>} parameterKeys - Key names for the stack parameters that you want to return
 * @returns {Promise<Object>} Object keyed by parameter names
 */
export const getCfStackParameterValues = async (
  stackName: string,
  parameterKeys: string[]
): Promise<{ [key: string]: string }> => {
  let response;
  try {
    response = await describeCfStack(stackName);
  } catch (error) {
    return {};
  }

  const parameters = (response.Parameters || []).reduce(
    (acc: { [key: string]: string }, { ParameterKey, ParameterValue }) => {
      if (ParameterKey && ParameterValue) return { ...acc, [ParameterKey]: ParameterValue };
      return acc;
    },
    {}
  );

  return pick(parameters, parameterKeys);
};
