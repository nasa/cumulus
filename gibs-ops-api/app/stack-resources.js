'use strict';

const { cf } = require('./aws');
const { fromJS } = require('immutable');
const { memoize } = require('./cache');

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
const getStackResources = memoize('getStackResources', async (arnOrStackName) => {
  console.log(`MTH-DEBUG Calling getStackResources on ${arnOrStackName}`);
  const stackName = arnToName(arnOrStackName);
  console.log(`MTH-DEBUG stackName=${stackName}`);
  const asdf = await cf().describeStackResources({ StackName: stackName }).promise();
  console.log(`MTH-DEBUG asdf=${JSON.stringify(asdf)}`);
  const resp = fromJS(asdf);
  console.log(`MTH-DEBUG resp=${resp}`);
  return resp.get('StackResources').groupBy(m => m.get('LogicalResourceId')).map(v => v.first());
});

/**
 * Returns a map of ingest stack resources loaded from cloud formation.
 */
const getIngestStackResources = stackName => getStackResources(`${stackName}-ingest`);

/**
 * Takes a stack resource map and a logical id and extracts the PhysicalResourceId.
 */
const getPhysicalResourceId = (stackResources, logicalId) =>
  stackResources.getIn([logicalId, 'PhysicalResourceId']);

module.exports = {
  getStackResources,
  getPhysicalResourceId,
  getIngestStackResources
};
