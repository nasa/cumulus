'use strict';

const { cf } = require('./aws');
const { fromJS } = require('immutable');

/**
 * Takes in what might be an ARN and if it is parses out the name. If it is not an ARN returns it
 * without changes.
 */
const arnToName = (arnMaybe) => {
  if (arnMaybe.startsWith('arn:')) {
    return arnMaybe.split('/')[1];
  }
  return arnMaybe;
};

/**
 * Fetches the stack and returns a map of logical resource id to stack information.
 */
const getStackResources = async (arnOrStackName) => {
  const stackName = arnToName(arnOrStackName);
  const resp = fromJS(await cf().describeStackResources({ StackName: stackName }).promise());
  return resp.get('StackResources').groupBy(m => m.get('LogicalResourceId')).map(v => v.first());
};

// Potential performation optimization:
// Fetching all the stack resources and ids for things is slow. We could add memoization to speed up
// performance.

/**
 * TODO
 */
const getIngestStackResources = async (stackName) => {
  const mainStackResources = await getStackResources(stackName);
  return getStackResources(
    mainStackResources.getIn(['IngestStack', 'PhysicalResourceId']));
};

/**
 * TODO
 */
const getPhysicalResourceId = (stackResources, logicalId) =>
  stackResources.getIn([logicalId, 'PhysicalResourceId']);

module.exports = {
  getStackResources,
  getPhysicalResourceId,
  getIngestStackResources
};
