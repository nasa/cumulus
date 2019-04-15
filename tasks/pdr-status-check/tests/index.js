'use strict';

const isEqual = require('lodash.isequal');
const some = require('lodash.some');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const {
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { checkPdrStatuses } = require('..');

test('valid output when no running executions', async (t) => {
  const event = {
    input: {
      running: [],
      pdr: { name: 'test.PDR', path: 'test-path' }
    }
  };

  await validateInput(t, event.input);

  const output = await checkPdrStatuses(event);

  await validateOutput(t, output);
  const expectedOutput = {
    isFinished: true,
    running: [],
    failed: [],
    completed: [],
    pdr: { name: 'test.PDR', path: 'test-path' }
  };

  t.deepEqual(output, expectedOutput);
});

test.serial('error thrown when limit exceeded', async (t) => {
  const event = {
    input: {
      running: ['arn:123'],
      counter: 2,
      limit: 3,
      pdr: { name: 'test.PDR', path: 'test-path' }
    }
  };

  const sfn = aws.sfn();
  try {
    sfn.describeExecution = () => ({
      promise: () => Promise.resolve({
        status: 'RUNNING',
        executionArn: 'arn:123'
      })
    });

    await checkPdrStatuses(event);
    t.fail();
  } catch (err) {
    t.is(err.name, 'IncompleteWorkflowError');
  } finally {
    delete sfn.describeExecution;
  }
});

test.serial('returns the correct results in the nominal case', async (t) => {
  const event = {
    input: {
      running: ['arn:1', 'arn:2', 'arn:3', 'arn:4', 'arn:7'],
      completed: ['arn:5'],
      failed: [{ arn: 'arn:6', reason: 'OutOfCheese' }],
      counter: 5,
      limit: 10,
      pdr: { name: 'test.PDR', path: 'test-path' }
    }
  };

  await validateInput(t, event.input);

  const executionStatuses = {
    'arn:1': 'RUNNING',
    'arn:2': 'SUCCEEDED',
    'arn:3': 'FAILED',
    'arn:4': 'ABORTED',
    'arn:7': null
  };

  const sfn = aws.sfn();

  let output;
  try {
    sfn.describeExecution = ({ executionArn }) => ({
      promise: () => {
        if (!executionStatuses[executionArn]) {
          const error = new Error(`Execution does not exist: ${executionArn}`);
          error.code = 'ExecutionDoesNotExist';
          return Promise.reject(error);
        }
        return Promise.resolve({
          executionArn,
          status: executionStatuses[executionArn]
        });
      }
    });

    output = await checkPdrStatuses(event);
  } finally {
    delete sfn.describeExecution;
  }

  await validateOutput(t, output);
  t.false(output.isFinished);
  t.is(output.counter, 6);
  t.is(output.limit, 10);

  t.deepEqual(output.running, ['arn:1', 'arn:7']);
  t.deepEqual(output.completed.sort(), ['arn:2', 'arn:5'].sort());

  t.is(output.failed.length, 3);
  const expectedFailed = [
    { arn: 'arn:6', reason: 'OutOfCheese' },
    { arn: 'arn:3', reason: 'Workflow Failed' },
    { arn: 'arn:4', reason: 'Workflow Aborted' }
  ];
  expectedFailed.forEach((expectedItem) => {
    const matches = (o) => isEqual(expectedItem, o);
    t.true(
      some(output.failed, matches),
      `${JSON.stringify(expectedItem)} not found in ${JSON.stringify(output.failed)}`
    );
  });
});
