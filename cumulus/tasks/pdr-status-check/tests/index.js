'use strict';

const _ = require('lodash');
const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');
const { checkPdrStatuses } = require('../index');

test('valid output when no running executions', (t) => {
  const event = {
    input: {
      running: [],
      pdr: { name: 'test.PDR', path: 'test-path' }
    }
  };

  return checkPdrStatuses(event)
    .then((output) => {
      const expectedOutput = {
        isFinished: true,
        running: [],
        failed: [],
        completed: [],
        pdr: { name: 'test.PDR', path: 'test-path' }
      };

      t.deepEqual(output, expectedOutput);
    });
});

test('error thrown when limit exceeded', (t) => {
  const stubSfnClient = {
    describeExecution: ({ executionArn }) => ({
      promise: () => Promise.resolve({
        status: 'RUNNING',
        executionArn
      })
    })
  };
  const stub = sinon.stub(aws, 'sfn').returns(stubSfnClient);

  const event = {
    input: {
      running: ['arn:123'],
      counter: 2,
      limit: 3,
      pdr: { name: 'test.PDR', path: 'test-path' }
    }
  };

  return checkPdrStatuses(event)
    .then(() => {
      stub.restore();
      t.fail();
    })
    .catch((err) => {
      stub.restore();
      t.is(err.name, 'IncompleteWorkflowError');
    });
});

test('returns the correct results in the nominal case', (t) => {
  const executionStatuses = {
    'arn:1': 'RUNNING',
    'arn:2': 'SUCCEEDED',
    'arn:3': 'FAILED',
    'arn:4': 'ABORTED',
    'arn:7': null
  };

  const stubSfnClient = {
    describeExecution: ({ executionArn }) => ({
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
    })
  };
  const stub = sinon.stub(aws, 'sfn').returns(stubSfnClient);

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

  return checkPdrStatuses(event)
    .then((output) => {
      stub.restore();

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
        const matches = (o) => _.isEqual(expectedItem, o); // eslint-disable-line require-jsdoc
        t.true(
          _.some(output.failed, matches),
          `${JSON.stringify(expectedItem)} not found in ${JSON.stringify(output.failed)}`
        );
      });
    });
});
