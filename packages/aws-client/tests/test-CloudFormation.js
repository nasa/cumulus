'use strict';

const rewire = require('rewire');
const test = require('ava');

const CloudFormation = rewire('../CloudFormation');

test.serial('describeCfStack() returns the stack information', async (t) => {
  const stack = { foo: 'bar' };
  const actualStack = await CloudFormation.__with__({
    cf: () => ({
      describeStacks: () => ({
        promise: () => Promise.resolve({
          Stacks: [stack]
        })
      })
    })
  })(() => CloudFormation.describeCfStack('test'));
  t.deepEqual(actualStack, stack);
});

test.serial('describeCfStack() returns undefined for stack that does not exist', async (t) => {
  const actualStack = await CloudFormation.__with__({
    cf: () => ({
      describeStacks: () => ({
        promise: () => Promise.resolve({
          Stacks: []
        })
      })
    })
  })(() => CloudFormation.describeCfStack('test'));
  t.is(actualStack, undefined);
});

test.serial('describeCfStackResources() returns resources for stack', async (t) => {
  const StackResources = 'resources';
  const actualStackResources = await CloudFormation.__with__({
    cf: () => ({
      describeStackResources: () => ({
        promise: () => Promise.resolve({
          StackResources
        })
      })
    })
  })(() => CloudFormation.describeCfStackResources('test'));
  t.is(actualStackResources, StackResources);
});

test.serial('getCfStackParameterValues() returns empty object if no stack is found', async (t) => {
  const parameters = await CloudFormation.__with__({
    cf: () => ({
      describeStacks: () => ({
        promise: () => Promise.resolve({
          Stacks: []
        })
      })
    })
  })(
    () => CloudFormation.getCfStackParameterValues('test', ['foo'])
  );
  t.deepEqual(parameters, {});
});

test.serial('getCfStackParameterValues() returns object excluding keys for missing parameters', async (t) => {
  const parameters = await CloudFormation.__with__({
    cf: () => ({
      describeStacks: () => ({
        promise: () => Promise.resolve({
          Stacks: [{
            Parameters: []
          }]
        })
      })
    })
  })(
    () => CloudFormation.getCfStackParameterValues('test', [
      'foo'
    ])
  );
  t.deepEqual(parameters, {});
});

test.serial('getCfStackParameterValues() returns requested stack parameters', async (t) => {
  const parameters = await CloudFormation.__with__({
    cf: () => ({
      describeStacks: () => ({
        promise: () => Promise.resolve({
          Stacks: [{
            Parameters: [{
              ParameterKey: 'foo',
              ParameterValue: 'bar'
            }, {
              ParameterKey: 'key',
              ParameterValue: 'value'
            }]
          }]
        })
      })
    })
  })(
    () => CloudFormation.getCfStackParameterValues('test', [
      'foo',
      'key'
    ])
  );
  t.deepEqual(parameters, {
    foo: 'bar',
    key: 'value'
  });
});
