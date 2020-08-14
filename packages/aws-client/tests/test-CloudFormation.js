'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const CloudFormation = require('../CloudFormation');
const { cf } = require('../services');

test('describeCfStack() returns the stack information', async (t) => {
  const StackName = cryptoRandomString({ length: 10 });

  await cf().createStack({
    StackName,
    TemplateBody: JSON.stringify({
      Resources: {},
    }),
  }).promise();

  const actualStack = await CloudFormation.describeCfStack(StackName);

  t.is(actualStack.StackName, StackName);

  await cf().deleteStack({ StackName }).promise();
});

test('describeCfStack() throws an exception for stack that does not exist', (t) =>
  t.throwsAsync(() => CloudFormation.describeCfStack('test')));

test('describeCfStackResources() returns resources for stack', async (t) => {
  const StackName = cryptoRandomString({ length: 10 });

  await cf().createStack({
    StackName,
    TemplateBody: JSON.stringify({
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
        },
      },
    }),
  }).promise();

  const actualStackResources = await CloudFormation.describeCfStackResources(StackName);

  t.is(actualStackResources.length, 1);
  t.is(actualStackResources[0].StackName, StackName);
  t.is(actualStackResources[0].ResourceType, 'AWS::S3::Bucket');

  await cf().deleteStack({ StackName }).promise();
});

test('getCfStackParameterValues() returns empty object if no stack is found', async (t) => {
  const parameters = await CloudFormation.getCfStackParameterValues('test', ['foo']);

  t.deepEqual(parameters, {});
});

test('getCfStackParameterValues() returns object excluding keys for missing parameters', async (t) => {
  const StackName = cryptoRandomString({ length: 10 });

  await cf().createStack({
    StackName,
    TemplateBody: JSON.stringify({
      Resources: {},
    }),
  }).promise();

  const parameters = await CloudFormation.getCfStackParameterValues('test', ['foo']);

  t.deepEqual(parameters, {});

  await cf().deleteStack({ StackName }).promise();
});

test('getCfStackParameterValues() returns requested stack parameters', async (t) => {
  const StackName = cryptoRandomString({ length: 10 });

  await cf().createStack({
    StackName,
    TemplateBody: JSON.stringify({
      Parameters: {
        foo: { Type: 'String' },
        key: { Type: 'String' },
      },
      Resources: {},
    }),
    Parameters: [
      { ParameterKey: 'foo', ParameterValue: 'bar' },
      { ParameterKey: 'key', ParameterValue: 'value' },
    ],
  }).promise();

  const parameters = await CloudFormation.getCfStackParameterValues(StackName, ['foo', 'key']);

  t.deepEqual(
    parameters,
    {
      foo: 'bar',
      key: 'value',
    }
  );

  await cf().deleteStack({ StackName }).promise();
});
