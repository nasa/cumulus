'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const CloudFormation = require('../CloudFormation');
const { cf } = require('../services');

/**
 * Delete a stack but don't fail the test if stack deletion fails.
 *
 * There are times in these tests where the bucket created in the test can still be in the
 * `UPDATE_IN_PROGRESS` state when we try to delete the stack, which results in a `NoSuchBucket`
 * error. Since these are just being created in LocalStack, a couple extra buckets don't make a
 * difference, so there's no reason to fail the test. Just log that the error happened and move on.
 *
 * @param {string} StackName
 * @returns {Promise<void>}
 */
const deleteStack = async (StackName) => {
  try {
    await cf().deleteStack({ StackName }).promise();
  } catch (error) {
    console.log(`Failed to delete stack ${StackName}: ${error}`);
  }
};

test('describeCfStack() returns the stack information', async (t) => {
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

  const actualStack = await CloudFormation.describeCfStack(StackName);

  t.is(actualStack.StackName, StackName);

  await deleteStack(StackName);
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

  await deleteStack(StackName);
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
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
        },
      },
    }),
  }).promise();

  const parameters = await CloudFormation.getCfStackParameterValues('test', ['foo']);

  t.deepEqual(parameters, {});

  await deleteStack(StackName);
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
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
        },
      },
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

  await deleteStack(StackName);
});
