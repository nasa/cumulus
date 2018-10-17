'use strict';

const test = require('ava');
const td = require('testdouble');

const CloudFormationGateway = require('../CloudFormationGateway');

function buildDescribeStacksResponse(StackStatus) {
  return {
    Stacks: [
      { StackStatus }
    ]
  };
}

test('getStackStatus returns the correct stack status', async (t) => {
  const cfService = td.object(['describeStacks']);

  td
    .when(cfService.describeStacks(td.matchers.contains({ StackName: 'stack-name' })))
    .thenReturn({
      promise: () => {
        const response = buildDescribeStacksResponse('UPDATE_COMPLETE');
        return Promise.resolve(response);
      }
    });

  const cloudFormationGateway = new CloudFormationGateway(cfService);

  const status = await cloudFormationGateway.getStackStatus('stack-name');

  t.is(status, 'UPDATE_COMPLETE');
});

test('getStackStatus will retry if a throttling exception is encountered', async (t) => {
  const throttlingResult = { code: 'ThrottlingException' };
  const goodResult = buildDescribeStacksResponse('UPDATE_COMPLETE');

  const cfService = td.object(['describeStacks']);

  td
    .when(cfService.describeStacks(td.matchers.contains({ StackName: 'stack-name' })))
    .thenReturn(
      { promise: () => Promise.reject(throttlingResult) },
      { promise: () => Promise.resolve(goodResult) }
    );

  const cloudFormationGateway = new CloudFormationGateway(cfService);

  const status = await cloudFormationGateway.getStackStatus('stack-name');

  t.is(status, 'UPDATE_COMPLETE');
});
