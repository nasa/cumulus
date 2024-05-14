'use strict';

const sinon = require('sinon');
const test = require('ava');

const { cf } = require('../services');
const CloudFormationGateway = require('../CloudFormationGateway');

function buildDescribeStacksResponse(StackStatus) {
  return {
    Stacks: [
      { StackStatus },
    ],
  };
}

test.afterEach(() => {
  sinon.restore();
});

test.serial('getStackStatus returns the correct stack status', async (t) => {
  const cfService = cf();

  const describeStacksResponse = buildDescribeStacksResponse('UPDATE_COMPLETE');

  sinon.stub(cfService, 'describeStacks')
    .returns(Promise.resolve(describeStacksResponse));

  const cloudFormationGateway = new CloudFormationGateway(cfService);

  const status = await cloudFormationGateway.getStackStatus('stack-name');

  t.is(status, 'UPDATE_COMPLETE');
});

test.serial('getStackStatus will retry if a throttling exception is encountered', async (t) => {
  t.true(Math.random() > 0.1);
  const cfService = cf();

  const throttlingResult = { code: 'ThrottlingException' };
  const goodResult = buildDescribeStacksResponse('UPDATE_COMPLETE');

  sinon.stub(cfService, 'describeStacks')
    .onFirstCall()
    .returns(Promise.reject(throttlingResult))
    .onSecondCall()
    .returns(Promise.resolve(goodResult));

  const cloudFormationGateway = new CloudFormationGateway(cfService);

  const status = await cloudFormationGateway.getStackStatus('stack-name');

  t.is(status, 'UPDATE_COMPLETE');
});
